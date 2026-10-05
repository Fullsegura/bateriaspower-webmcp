import { describe, expect, it, vi } from "vitest";
import { allPaymentTools, bindPaymentActions, getCheckoutContextTool, getPaymentStatusTool, startCardCheckoutTool, type PaymentActions } from "./webmcp-tools";

describe("herramientas de pago WebMCP", () => {
  it("separa apertura, consulta de contexto y consulta de estado sin herramienta de cobro", () => {
    expect(allPaymentTools.map((tool) => tool.name)).toEqual(["start_card_checkout", "get_checkout_context", "get_payment_status"]);
    expect(startCardCheckoutTool.inputSchema?.required).toEqual(["productType", "productId", "fulfillment"]);
    expect(getPaymentStatusTool.inputSchema?.required).toEqual(["transactionId"]);
  });
  it("rechaza una modalidad ausente sin iniciar el flujo", async () => {
    const actions = { start: vi.fn() } as unknown as PaymentActions;
    const unbind = bindPaymentActions(actions);
    expect(await startCardCheckoutTool.execute({ productType: "battery", productId: "product-test" })).toEqual({ ok: false, error: "Elige retiro o domicilio." });
    expect(actions.start).not.toHaveBeenCalled();
    unbind();
  });
  it("ejecuta la apertura con inputs exactos y devuelve el contexto visible", async () => {
    const context = { quote: null, transaction: null };
    const actions = { start: vi.fn(async () => ({ id: "quote-test" })), getContext: vi.fn(() => context), status: vi.fn(async () => ({ id: "payment-test", status: "PENDING" })) } as unknown as PaymentActions;
    const unbind = bindPaymentActions(actions);
    expect(await startCardCheckoutTool.execute({ productType: "tire", productId: "product-test", fulfillment: "pickup" })).toEqual({ id: "quote-test" });
    expect(actions.start).toHaveBeenCalledWith("tire", "product-test", "pickup", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await getCheckoutContextTool.execute({})).toEqual(context);
    expect(await getPaymentStatusTool.execute({ transactionId: "payment-test" })).toEqual({ id: "payment-test", status: "PENDING" });
    unbind();
  });
  it("una limpieza anterior no elimina el binding actual", async () => {
    const previous = bindPaymentActions({ getContext: vi.fn() } as unknown as PaymentActions);
    const active = { getContext: vi.fn(() => ({ quote: null, transaction: null })) } as unknown as PaymentActions;
    const current = bindPaymentActions(active);
    previous(); await getCheckoutContextTool.execute({});
    expect(active.getContext).toHaveBeenCalledOnce(); current();
  });
});
