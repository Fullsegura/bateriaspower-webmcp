import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogSession, requireCatalogSession } from "@/lib/catalog-session";
import { handlePagoPluxWebhook, handlePaymentRequest, paymentMode } from "@/lib/payments/service";
import { getCatalogPreviewBattery } from "@/lib/battery-catalog";
import type { Battery, Tire } from "@/types/catalog";
import type { PaymentCheckout, PaymentQuote } from "@/types/payment";

let directory: string;
let sessionId: string;
let battery: Battery;
const billing = { fullName: "Cliente Prueba", identification: "1234567890", phone: "0991234567", email: "cliente@example.com", address: "Dirección de facturación" };
const delivery = { latitude: -0.2, longitude: -78.5, address: "Dirección de entrega", reference: "Puerta verde" };
function request(body: unknown, session = sessionId): Request {
  return new Request("http://localhost:3000/api/payments/test", {
    method: "POST", headers: { "content-type": "application/json", "x-catalog-session": session }, body: JSON.stringify(body),
  });
}
async function stage(fulfillment = "pickup"): Promise<PaymentQuote> {
  const location = battery.locations.find((entry) => entry.fulfillment === fulfillment)!;
  const response = await handlePaymentRequest(request({ productType: "battery", productId: battery.id, quantity: 1, locationId: location.id, fulfillment }), "quote");
  expect(response.status).toBe(200);
  return response.json();
}
async function checkout(quote: PaymentQuote): Promise<PaymentCheckout> {
  const response = await handlePaymentRequest(request({ quoteId: quote.id, billing }), "checkout");
  expect(response.status).toBe(200);
  return response.json();
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "powerauto-payment-test-"));
  vi.stubEnv("PAYMENTS_STORAGE_DIR", directory);
  vi.stubEnv("PAYMENT_MODE", "simulation");
  vi.stubEnv("PAGOPLUX_ENVIRONMENT", "sandbox");
  vi.stubEnv("PAGOPLUX_MERCHANT_EMAIL", "merchant@example.com");
  vi.stubEnv("PAGOPLUX_WEBHOOK_BASIC_TOKEN", "test-webhook-token");
  sessionId = createCatalogSession();
  battery = structuredClone(getCatalogPreviewBattery()!);
  requireCatalogSession(request({})).products = { productType: "battery", items: [battery] };
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("checkout local", () => {
  it("acepta cotizar desde el origen HTTPS público detrás de ingress", async () => {
    const response = await handlePaymentRequest(new Request("http://0.0.0.0:3000/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json", "x-catalog-session": sessionId,
        host: "webmcp.fullsegura.com", origin: "https://webmcp.fullsegura.com", "x-forwarded-proto": "https" },
      body: JSON.stringify({ productType: "battery", productId: battery.id, quantity: 1,
        locationId: battery.locations[0].id, fulfillment: "pickup" }),
    }), "quote");
    expect(response.status).toBe(200);
    expect((await response.json()).totalAmountCents).toBe(Math.round(battery.price * 100));
  });
  it("calcula el importe en servidor y no acepta totales enviados por el navegador", async () => {
    const location = battery.locations[0];
    const response = await handlePaymentRequest(request({ productType: "battery", productId: battery.id, quantity: 2, fulfillment: "pickup", locationId: location.id, totalAmountCents: 1 }), "quote");
    expect((await response.json()).totalAmountCents).toBe(Math.round(battery.price * 200));
  });
  it("requiere todos los datos de facturación", async () => {
    const quote = await stage();
    expect((await handlePaymentRequest(request({ quoteId: quote.id, billing: { email: "a@b.com" } }), "checkout")).status).toBe(400);
  });
  it("exige y conserva una ubicación confirmada para domicilio", async () => {
    const quote = await stage("delivery");
    expect((await handlePaymentRequest(request({ quoteId: quote.id, billing }), "checkout")).status).toBe(400);
    expect((await handlePaymentRequest(request({ quoteId: quote.id, delivery: { ...delivery, latitude: 91 } }), "delivery")).status).toBe(400);
    expect((await handlePaymentRequest(request({ quoteId: quote.id, delivery }), "delivery")).status).toBe(200);
    const result = await checkout(quote);
    expect(result.transaction.delivery).toEqual(delivery);
    expect((await handlePaymentRequest(request({ quoteId: quote.id, delivery }), "delivery")).status).toBe(400);
    const file = JSON.parse(await readFile(join(directory, "payments.json"), "utf8"));
    expect(file.quotes[0].delivery).toEqual(delivery);
  });
  it("rechaza modalidad incompatible con la localidad", async () => {
    const response = await handlePaymentRequest(request({ productType: "battery", productId: battery.id, quantity: 1, locationId: battery.locations[0].id, fulfillment: "delivery" }), "quote");
    expect(response.status).toBe(400);
  });
  it("rechaza productos y transacciones ajenos a la sesión", async () => {
    const response = await handlePaymentRequest(request({ productType: "battery", productId: "unknown", quantity: 1, locationId: battery.locations[0].id, fulfillment: "pickup" }), "quote");
    expect(response.status).toBe(400);
    const payment = await checkout(await stage());
    expect((await handlePaymentRequest(request({ transactionId: payment.transaction.id }, createCatalogSession()), "status")).status).toBe(400);
  });
  it("protege reintentos concurrentes y conserva un solo pago pendiente", async () => {
    const quote = await stage();
    const results = await Promise.all([checkout(quote), checkout(quote)]);
    expect(results[0].transaction.id).toBe(results[1].transaction.id);
    expect(results[0].transaction.status).toBe("PENDING");
    expect(results[0].form).toBeNull();
    expect(results[0].transaction).not.toHaveProperty("billing");
  });
  it("prueba aprobación y prohíbe cambiar un resultado final", async () => {
    const payment = await checkout(await stage());
    const body = { transactionId: payment.transaction.id, outcome: "approved" };
    const response = await handlePaymentRequest(request(body), "simulate");
    expect((await response.json()).status).toBe("VALIDATED");
    expect((await handlePaymentRequest(request(body), "simulate")).status).toBe(200);
    expect((await handlePaymentRequest(request({ ...body, outcome: "declined" }), "simulate")).status).toBe(400);
  });
  it.each(["declined", "cancelled"])("permite reintentar después de %s sin reutilizar el pago final", async (outcome) => {
    const quote = await stage();
    const previous = await checkout(quote);
    await handlePaymentRequest(request({ transactionId: previous.transaction.id, outcome }), "simulate");
    const retry = await checkout(quote);
    expect(retry.transaction.id).not.toBe(previous.transaction.id);
    expect(retry.transaction.status).toBe("PENDING");
  });
  it("rechaza orígenes ajenos", async () => {
    const req = request({});
    req.headers.set("origin", "https://other.example");
    expect((await handlePaymentRequest(req, "quote")).status).toBe(403);
  });
  it("revalida el inventario antes de crear el pago", async () => {
    const quote = await stage();
    battery.locations[0].inventory = 0;
    expect((await handlePaymentRequest(request({ quoteId: quote.id, billing }), "checkout")).status).toBe(400);
  });
  it("recalcula también la cotización de llantas y exige el local de retiro", async () => {
    const tire = {
      id: "tire-test", name: "Llanta de prueba", totalStock: 8,
      warehouses: [{ cityId: "city-test", warehouseId: "warehouse-test", warehouseName: "Local prueba", quantity: 8 }],
      price: { unitWithoutVat: 100, unitKnownChargesTotal: 116.15, ecoValue: 1, vatPercent: 15, status: "available" },
    } as Tire;
    requireCatalogSession(request({})).products = { productType: "tire", items: [tire] };
    const input = { productType: "tire", productId: tire.id, quantity: 2, fulfillment: "pickup" };
    expect((await handlePaymentRequest(request(input), "quote")).status).toBe(400);
    const result = await handlePaymentRequest(request({ ...input, warehouseId: "warehouse-test" }), "quote");
    const quote = await result.json();
    expect(quote.totalAmountCents).toBe(23230);
    expect((await checkout(quote)).transaction.totalAmountCents).toBe(23230);
  });
});

describe("contrato PagoPlux copiado", () => {
  async function sandboxPayment() { vi.stubEnv("PAYMENT_MODE", "pagoplux_sandbox"); return checkout(await stage()); }
  function webhook(payment: PaymentCheckout, amount: unknown, id = "provider-1") {
    return new Request("http://localhost:3000/api/payments/pagoplux/webhook", {
      method: "POST", headers: { authorization: "Basic test-webhook-token", "content-type": "application/json" },
      body: JSON.stringify({ state: "PAGADO", PayboxExtras: payment.transaction.id, id_transaccion: id, amount }),
    });
  }
  it("copia el formulario sandbox sin habilitar producción ni aprobar por retorno del navegador", async () => {
    const payment = await sandboxPayment();
    expect(payment.form!.action).toBe("https://sandbox-paybox.pagoplux.com/movil.html");
    expect(payment.form!.fields.PayboxExtras).toBe(payment.transaction.id);
    expect(payment.form!.fields.PayboxProduction).toBe(false);
    const response = await handlePaymentRequest(request({ transactionId: payment.transaction.id, payload: { status: "success", amount: payment.transaction.totalAmountCents / 100 } }), "return");
    expect((await response.json()).status).toBe("PENDING");
    expect((await handlePaymentRequest(request({ transactionId: payment.transaction.id, outcome: "approved" }), "simulate")).status).toBe(400);
    vi.stubEnv("PAGOPLUX_ENVIRONMENT", "production");
    expect(() => paymentMode()).toThrow("sandbox");
  });
  it("rechaza configuración incompleta sin pasar silenciosamente a simulación", async () => {
    vi.stubEnv("PAYMENT_MODE", "pagoplux_sandbox"); vi.stubEnv("PAGOPLUX_MERCHANT_EMAIL", "");
    const quote = await stage();
    expect((await handlePaymentRequest(request({ quoteId: quote.id, billing }), "checkout")).status).toBe(400);
  });
  it("confirma solamente webhook autenticado con importe exacto e idempotencia", async () => {
    const payment = await sandboxPayment();
    const invalid = webhook(payment, payment.transaction.totalAmountCents / 100);
    invalid.headers.delete("authorization");
    expect((await handlePagoPluxWebhook(invalid)).status).toBe(401);
    expect((await handlePagoPluxWebhook(webhook(payment, null))).status).toBe(400);
    expect((await handlePagoPluxWebhook(webhook(payment, 0.01))).status).toBe(400);
    const valid = () => webhook(payment, payment.transaction.totalAmountCents / 100);
    expect((await handlePagoPluxWebhook(valid())).status).toBe(200);
    expect((await handlePagoPluxWebhook(valid())).status).toBe(200);
    const response = await handlePaymentRequest(request({ transactionId: payment.transaction.id }), "status");
    expect((await response.json()).status).toBe("VALIDATED");
  });
});
