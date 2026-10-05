import { defineTool } from "@nekuda/webmcp-sdk";
import { withCatalogExecution } from "@/features/webmcp/execution-guard";
import { executeSafely } from "@/features/webmcp/tools/tires";
import { requiredText } from "@/lib/payments/validation";
import type { CatalogExecutionContext, ProductKind } from "@/types/catalog";
import type { CheckoutContext, Fulfillment, PaymentQuote, PaymentTransaction } from "@/types/payment";

export interface PaymentActions {
  start(productType: ProductKind, productId: string, fulfillment: Fulfillment, execution?: CatalogExecutionContext): Promise<PaymentQuote>;
  getContext(): CheckoutContext;
  status(transactionId: string, execution?: CatalogExecutionContext): Promise<PaymentTransaction>;
}
let binding: { actions: PaymentActions; token: symbol } | null = null;
function actions(): PaymentActions {
  if (!binding) throw new Error("El pago todavía no está disponible.");
  return binding.actions;
}
export function bindPaymentActions(next: PaymentActions): () => void {
  const token = Symbol("payment-actions");
  binding = { actions: next, token };
  return () => { if (binding?.token === token) binding = null; };
}

export const startCardCheckoutTool = defineTool({
  stableKey: "payment.start_card_checkout",
  name: "start_card_checkout",
  title: "Abrir pago con tarjeta",
  description: "Abre directamente el formulario después de cotizar con éxito, sin preguntar si desea abrirlo y sin cobrar. Requiere producto y cantidad ya confirmados y cotizados, y modalidad elegida por el usuario. Usa los IDs exactos del producto cotizado. Para baterías la modalidad debe corresponder a su localidad cotizada. El usuario completa datos de facturación y pulsa Pagar; para delivery, el formulario solicita su ubicación y guarda automáticamente las coordenadas y dirección. Puede corregir el pin y los textos sin confirmación adicional. No pidas datos de tarjeta en el chat.",
  inputSchema: {
    type: "object", additionalProperties: false,
    properties: {
      productType: { type: "string", enum: ["tire", "battery"] },
      productId: { type: "string" },
      fulfillment: { type: "string", enum: ["pickup", "delivery"] },
    },
    required: ["productType", "productId", "fulfillment"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true }, intent: "act",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => {
      if (input.productType !== "tire" && input.productType !== "battery") throw new Error("productType inválido.");
      if (input.fulfillment !== "pickup" && input.fulfillment !== "delivery") throw new Error("Elige retiro o domicilio.");
      return actions().start(input.productType, requiredText(input.productId, "Producto"), input.fulfillment, execution);
    }));
  },
});

export const getCheckoutContextTool = defineTool({
  stableKey: "payment.context", name: "get_checkout_context", title: "Consultar cotización y entrega para el pago",
  description: "Devuelve la cotización de pago, ubicación guardada y transacción actuales. No inicia ni confirma un pago. Úsala para obtener el contexto verificado y el transactionId antes de consultar su estado.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] },
  annotations: { readOnlyHint: true, untrustedContentHint: true }, intent: "answer",
  execute() { return executeSafely(() => actions().getContext()); },
});

export const getPaymentStatusTool = defineTool({
  stableKey: "payment.status", name: "get_payment_status", title: "Consultar estado del pago",
  description: "Consulta el estado guardado por el backend para el transactionId de get_checkout_context. Solo VALIDATED acredita el resultado aprobado; PENDING no lo confirma. mode distingue simulación local de PagoPlux sandbox.",
  inputSchema: { type: "object", properties: { transactionId: { type: "string" } }, additionalProperties: false, required: ["transactionId"] },
  annotations: { readOnlyHint: true, untrustedContentHint: true }, intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => actions().status(requiredText(input.transactionId, "Transacción"), execution)));
  },
});
export const allPaymentTools = [startCardCheckoutTool, getCheckoutContextTool, getPaymentStatusTool];
