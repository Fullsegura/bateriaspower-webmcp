import { createHash, randomUUID } from "node:crypto";
import { createQuote, requireTire } from "@/lib/catalog-search";
import { createBatteryQuote, requireBattery } from "@/lib/battery-catalog";
import { requireCatalogSession, requireSessionProduct } from "@/lib/catalog-session";
import { buildPagoPluxForm, getWebhookPayloadTransactionId, isPaidWebhookPayload, normalizeMoneyToCents, normalizeProviderId, timingSafeBasicAuthMatches } from "@/lib/payments/pagoplux";
import { publicQuote, publicTransaction, withPaymentStore, type StoredQuote } from "@/lib/payments/store";
import { inputObject, parseBilling, parseDeliveryLocation, parsePaymentQuoteInput, requiredText } from "@/lib/payments/validation";
import type { Battery, Tire } from "@/types/catalog";
import type { PaymentMode, PaymentQuoteInput } from "@/types/payment";

function sessionHash(request: Request): string {
  requireCatalogSession(request);
  return createHash("sha256").update(request.headers.get("x-catalog-session")!).digest("hex");
}

export function paymentMode(): PaymentMode {
  const mode = process.env.PAYMENT_MODE ?? "simulation";
  if (mode !== "simulation" && mode !== "pagoplux_sandbox") throw new Error("PAYMENT_MODE inválido.");
  if (mode === "pagoplux_sandbox" && process.env.PAGOPLUX_ENVIRONMENT !== "sandbox") {
    throw new Error("Solo está habilitado PagoPlux sandbox en este alcance.");
  }
  return mode;
}

function calculateQuote(request: Request, input: PaymentQuoteInput) {
  const session = requireCatalogSession(request);
  requireSessionProduct(session, input.productType, input.productId);
  if (input.productType === "battery") {
    if (!input.locationId || input.warehouseId) throw new Error("La batería requiere una localidad exacta.");
    const items = session.products!.items as Battery[];
    const quote = createBatteryQuote(items, input.productId, input.quantity, input.locationId);
    if (quote.location.fulfillment !== input.fulfillment) {
      throw new Error("La modalidad de entrega no corresponde a la localidad elegida.");
    }
    return {
      productName: requireBattery(items, input.productId).name,
      totalAmountCents: Math.round(quote.total * 100),
      pickupLabel: input.fulfillment === "pickup" ? quote.location.location : null,
    };
  }
  if (input.locationId) throw new Error("La llanta requiere warehouseId, no locationId.");
  if (input.fulfillment === "pickup" && !input.warehouseId) throw new Error("Elige el local de retiro.");
  const items = session.products!.items as Tire[];
  const quote = createQuote(items, input.productId, input.quantity, input.warehouseId);
  if (quote.totalKnownCharges === null) throw new Error("El producto necesita un precio antes de iniciar el pago.");
  return {
    productName: requireTire(items, input.productId).name,
    totalAmountCents: Math.round(quote.totalKnownCharges * 100),
    pickupLabel: input.fulfillment === "pickup" ? quote.warehouse!.warehouseName : null,
  };
}

function requireOwnedQuote(quotes: StoredQuote[], id: unknown, owner: string): StoredQuote {
  const quote = quotes.find((item) => item.id === requiredText(id, "Cotización") && item.sessionHash === owner);
  if (!quote) throw new Error("La cotización no pertenece a esta sesión.");
  if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new Error("Vuelve a preparar la cotización antes de pagar.");
  return quote;
}

export async function handlePaymentRequest(request: Request, action: "quote" | "delivery" | "checkout" | "status" | "simulate" | "return"): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ detail: "Origen no permitido." }, { status: 403 });
    const owner = sessionHash(request);
    const body = inputObject(await request.json());
    const result = await withPaymentStore((store) => {
      if (action === "quote") {
        const input = parsePaymentQuoteInput(body);
        const calculated = calculateQuote(request, input);
        if (calculated.totalAmountCents <= 0) throw new Error("Importe de pago inválido.");
        store.quotes = store.quotes.filter((quote) => new Date(quote.expiresAt).getTime() > Date.now());
        if (store.quotes.length >= 200) throw new Error("Hay demasiadas cotizaciones activas.");
        const quote: StoredQuote = {
          ...input, ...calculated, id: randomUUID(), sessionHash: owner, currency: "USD", delivery: null,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        };
        store.quotes.push(quote);
        return publicQuote(quote);
      }
      if (action === "delivery") {
        const quote = requireOwnedQuote(store.quotes, body.quoteId, owner);
        if (quote.fulfillment !== "delivery") throw new Error("Esta cotización es para retiro.");
        if (store.transactions.some((item) => item.quoteId === quote.id && (item.status === "PENDING" || item.status === "VALIDATED"))) {
          throw new Error("La ubicación no puede cambiar durante el pago. Prepara otra cotización.");
        }
        quote.delivery = parseDeliveryLocation(body.delivery);
        return publicQuote(quote);
      }
      if (action === "checkout") {
        const quote = requireOwnedQuote(store.quotes, body.quoteId, owner);
        const billing = parseBilling(body.billing);
        if (quote.fulfillment === "delivery" && !quote.delivery) throw new Error("Completa la ubicación y dirección de entrega.");
        const calculated = calculateQuote(request, quote);
        if (calculated.totalAmountCents !== quote.totalAmountCents) throw new Error("El precio cambió. Prepara otra cotización.");
        const mode = paymentMode();
        const existing = store.transactions.find((item) => item.quoteId === quote.id && (item.status === "PENDING" || item.status === "VALIDATED"));
        if (existing) {
          if (JSON.stringify(existing.billing) !== JSON.stringify(billing)) throw new Error("Ya existe un pago con otros datos de facturación para esta cotización.");
          return {
            transaction: publicTransaction(existing),
            form: existing.mode === "pagoplux_sandbox" && existing.status === "PENDING" ? buildPagoPluxForm(existing, quote, billing) : null,
          };
        }
        if (store.transactions.length >= 1000) throw new Error("El registro local de pagos alcanzó su límite.");
        const transaction = {
          id: randomUUID(), quoteId: quote.id, sessionHash: owner, billing, mode, status: "PENDING" as const,
          totalAmountCents: quote.totalAmountCents, currency: quote.currency, productName: quote.productName,
          quantity: quote.quantity, fulfillment: quote.fulfillment, pickupLabel: quote.pickupLabel,
          delivery: quote.delivery, providerTransactionId: null, createdAt: new Date().toISOString(),
        };
        const form = mode === "pagoplux_sandbox" ? buildPagoPluxForm(transaction, quote, billing) : null;
        store.transactions.push(transaction);
        return { transaction: publicTransaction(transaction), form };
      }
      const id = requiredText(body.transactionId, "Transacción");
      const transaction = store.transactions.find((item) => item.id === id && item.sessionHash === owner);
      if (!transaction) throw new Error("El pago no pertenece a esta sesión.");
      if (action === "simulate") {
        if (transaction.mode !== "simulation" || paymentMode() !== "simulation") throw new Error("La simulación no está habilitada para este pago.");
        const statuses = { approved: "VALIDATED", declined: "DECLINED", cancelled: "CANCELLED" } as const;
        if (body.outcome !== "approved" && body.outcome !== "declined" && body.outcome !== "cancelled") throw new Error("Resultado de prueba inválido.");
        const status = statuses[body.outcome];
        if (transaction.status !== "PENDING" && transaction.status !== status) throw new Error("El pago ya tiene un resultado final.");
        transaction.status = status;
      } else if (action === "return") {
        if (transaction.mode !== "pagoplux_sandbox") throw new Error("Este pago no usa el formulario de PagoPlux.");
        const payload = inputObject(body.payload);
        const detail = payload.detail && typeof payload.detail === "object" ? payload.detail as Record<string, unknown> : {};
        const amount = normalizeMoneyToCents(detail.amount ?? payload.amount ?? payload.amountWoTaxes);
        if (amount !== null && amount !== transaction.totalAmountCents) throw new Error("El importe recibido no corresponde al pago.");
        // The browser return never confirms payment. Only the authenticated webhook does.
      }
      return publicTransaction(transaction);
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "No se pudo completar el pago." }, { status: 400 });
  }
}

export async function handlePagoPluxWebhook(request: Request): Promise<Response> {
  if (!timingSafeBasicAuthMatches(request.headers.get("authorization"))) return Response.json({ detail: "Unauthorized." }, { status: 401 });
  try {
    if (paymentMode() !== "pagoplux_sandbox") throw new Error("El webhook de PagoPlux no está activo en simulación.");
    const payload = inputObject(await request.json());
    if (!isPaidWebhookPayload(payload)) return Response.json({ received: true, ignored: true });
    const id = getWebhookPayloadTransactionId(payload);
    const amount = normalizeMoneyToCents(payload.amount ?? payload.monto ?? payload.total);
    const providerId = normalizeProviderId(payload.id_transaccion);
    if (!id || amount === null || !providerId) throw new Error("Faltan transacción, importe o referencia de PagoPlux.");
    const result = await withPaymentStore((store) => {
      const transaction = store.transactions.find((item) => item.id === id && item.mode === "pagoplux_sandbox");
      if (!transaction || transaction.totalAmountCents !== amount) throw new Error("El importe no corresponde a la transacción.");
      if (store.transactions.some((item) => item.id !== id && item.providerTransactionId === providerId)) throw new Error("La referencia de PagoPlux ya pertenece a otro pago.");
      if (transaction.status !== "PENDING" && !(transaction.status === "VALIDATED" && transaction.providerTransactionId === providerId)) throw new Error("El pago ya tiene otro resultado final.");
      transaction.status = "VALIDATED";
      transaction.providerTransactionId = providerId;
      return { received: true, transactionId: transaction.id, status: transaction.status };
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Invalid webhook." }, { status: 400 });
  }
}
