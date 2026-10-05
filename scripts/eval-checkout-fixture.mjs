import assert from "node:assert/strict";

// Catalog regressions open a fixture form, never a provider checkout or charge.
export async function bindCheckoutFixture(runtime, getState) {
  const { paymentQuoteInput } = await runtime.load("/src/features/payments/use-checkout.ts");
  let quote = null;
  return runtime.payments.bindPaymentActions({
    start: async (productType, productId, fulfillment) => {
      const input = paymentQuoteInput(getState(), fulfillment);
      assert.equal(input.productType, productType);
      assert.equal(input.productId, productId);
      quote = { ...input, id: "fixture-checkout", status: "READY" };
      return quote;
    },
    getContext: () => ({ quote, transaction: null, delivery: null }),
    status: () => { throw new Error("Estado de pago fuera del alcance de este eval de catálogo"); },
  });
}
