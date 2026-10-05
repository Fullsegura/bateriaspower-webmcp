"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bindPaymentActions } from "@/features/payments/webmcp-tools";
import type { BrowserCoordinates } from "@/lib/browser-location";
import type { CatalogExecutionContext, CatalogState, ProductKind } from "@/types/catalog";
import type { BillingDetails, CheckoutContext, DeliveryLocation, Fulfillment, PaymentCheckout, PaymentQuote, PaymentQuoteInput, PaymentTransaction } from "@/types/payment";

export function paymentQuoteInput(state: CatalogState, fulfillment: Fulfillment): PaymentQuoteInput {
  if (state.activeProductType === "battery" && state.batteryQuote) {
    return {
      productType: "battery", productId: state.batteryQuote.batteryId, quantity: state.batteryQuote.quantity,
      locationId: state.batteryQuote.location.id, fulfillment,
    };
  }
  if (state.activeProductType === "tire" && state.quote) {
    return {
      productType: "tire", productId: state.quote.tireId, quantity: state.quote.quantity,
      warehouseId: state.quote.warehouse?.warehouseId, fulfillment,
    };
  }
  throw new Error("Prepara la cotización antes de iniciar el pago.");
}

export function useCheckout(state: CatalogState, getSession: () => Promise<string>) {
  const sourceKey = JSON.stringify([state.queriedAt, state.activeProductType, state.quote, state.batteryQuote]);
  const sourceRef = useRef({ state, key: sourceKey });
  useEffect(() => { sourceRef.current = { state, key: sourceKey }; }, [state, sourceKey]);
  const savedRef = useRef<{ key: string; context: CheckoutContext; checkout: PaymentCheckout | null } | null>(null);
  const [saved, setSaved] = useState<typeof savedRef.current>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const quote = saved?.key === sourceKey ? saved.context.quote : null;
  const transaction = saved?.key === sourceKey ? saved.context.transaction : null;
  const checkout = saved?.key === sourceKey ? saved.checkout : null;

  const commit = useCallback((key: string, context: CheckoutContext, nextCheckout: PaymentCheckout | null) => {
    if (sourceRef.current.key !== key) throw new Error("La cotización cambió durante la operación.");
    const next = { key, context, checkout: nextCheckout };
    savedRef.current = next;
    setSaved(next);
  }, []);

  const post = useCallback(async <T,>(path: string, body: unknown, execution?: CatalogExecutionContext): Promise<T> => {
    const sessionId = await getSession();
    const response = await fetch(path, {
      method: "POST", headers: { "content-type": "application/json", "x-catalog-session": sessionId },
      body: JSON.stringify(body), signal: execution?.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail ?? "No se pudo completar el pago.");
    if (execution && !execution.isCurrent()) throw new DOMException("Ejecución cancelada.", "AbortError");
    return result as T;
  }, [getSession]);

  const start = useCallback(async (productType: ProductKind, productId: string, fulfillment: Fulfillment, execution?: CatalogExecutionContext) => {
    if (busyRef.current) throw new Error("Hay una operación de pago en curso.");
    const { state: current, key } = sourceRef.current;
    const input = paymentQuoteInput(current, fulfillment);
    if (input.productType !== productType || input.productId !== productId) throw new Error("El producto no corresponde a la cotización actual.");
    busyRef.current = true; setBusy(true); setError(null); setOpenKey(key);
    try {
      const currentSaved = savedRef.current;
      if (currentSaved?.key === key && currentSaved.context.quote?.fulfillment === fulfillment &&
          (currentSaved.context.transaction || new Date(currentSaved.context.quote.expiresAt).getTime() > Date.now())) return currentSaved.context.quote;
      const result = await post<PaymentQuote>("/api/payments/quote", input, execution);
      commit(key, { quote: result, transaction: null }, null);
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar el pago.");
      throw caught;
    } finally { busyRef.current = false; setBusy(false); }
  }, [commit, post]);

  const getContext = useCallback((): CheckoutContext => {
    const current = savedRef.current;
    return current?.key === sourceRef.current.key ? current.context : { quote: null, transaction: null };
  }, []);

  const status = useCallback(async (id: string, execution?: CatalogExecutionContext) => {
    const current = savedRef.current;
    if (!current || current.key !== sourceRef.current.key || current.context.transaction?.id !== id) {
      throw new Error("transactionId no pertenece al contexto de pago actual.");
    }
    const result = await post<PaymentTransaction>("/api/payments/status", { transactionId: id }, execution);
    commit(current.key, { ...current.context, transaction: result }, current.checkout ? { ...current.checkout, transaction: result } : null);
    return result;
  }, [commit, post]);

  const paymentActions = useMemo(() => ({ start, status, getContext }), [start, status, getContext]);
  useEffect(() => bindPaymentActions(paymentActions), [paymentActions]);

  const resolveAddress = useCallback(async (point: BrowserCoordinates, signal: AbortSignal) => {
    const result = await post<{ address: string }>("/api/payments/maps/address", point, {
      signal, isCurrent: () => !signal.aborted,
    });
    return result.address;
  }, [post]);

  async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(true); setError(null);
    try { return await operation(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar el pago."); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }

  function currentSaved() {
    const current = savedRef.current;
    if (!current || current.key !== sourceRef.current.key || !current.context.quote) throw new Error("La cotización de pago cambió.");
    return current;
  }

  return {
    open: openKey === sourceKey, quote, transaction, checkout, busy, error, start, getContext, resolveAddress,
    openDialog() { setError(null); setOpenKey(sourceRef.current.key); },
    close() { setOpenKey(null); },
    async chooseFulfillment(fulfillment: Fulfillment) {
      const input = paymentQuoteInput(sourceRef.current.state, fulfillment);
      return start(input.productType, input.productId, fulfillment).catch(() => null);
    },
    async saveDelivery(delivery: DeliveryLocation) {
      return run(async () => {
        const current = currentSaved();
        const result = await post<PaymentQuote>("/api/payments/delivery", { quoteId: current.context.quote!.id, delivery });
        commit(current.key, { quote: result, transaction: null }, null);
        return result;
      });
    },
    async pay(billing: BillingDetails) {
      return run(async () => {
        const current = currentSaved();
        const result = await post<PaymentCheckout>("/api/payments/pagoplux/checkout", { quoteId: current.context.quote!.id, billing });
        commit(current.key, { ...current.context, transaction: result.transaction }, result);
        if (result.transaction.mode === "simulation" && result.transaction.status === "PENDING") {
          const transaction = await post<PaymentTransaction>("/api/payments/simulate", { transactionId: result.transaction.id, outcome: "approved" });
          const completed = { ...result, transaction };
          commit(current.key, { ...current.context, transaction }, completed);
          return completed;
        }
        return result;
      });
    },
    async simulate(outcome: "approved" | "declined" | "cancelled") {
      return run(async () => {
        const current = currentSaved();
        if (!current.context.transaction) throw new Error("No hay un pago iniciado.");
        const result = await post<PaymentTransaction>("/api/payments/simulate", { transactionId: current.context.transaction.id, outcome });
        commit(current.key, { ...current.context, transaction: result }, current.checkout ? { ...current.checkout, transaction: result } : null);
        return result;
      });
    },
    async recordReturn(payload: unknown) {
      return run(async () => {
        const current = currentSaved();
        if (!current.context.transaction) throw new Error("No hay un pago iniciado.");
        const result = await post<PaymentTransaction>("/api/payments/pagoplux/return", { transactionId: current.context.transaction.id, payload });
        commit(current.key, { ...current.context, transaction: result }, current.checkout);
        return result;
      });
    },
    async refreshStatus() { const id = getContext().transaction?.id; if (id) return run(() => status(id)); return null; },
    retry() {
      const current = savedRef.current;
      if (current?.key === sourceRef.current.key && current.context.transaction?.status !== "VALIDATED") {
        commit(current.key, { ...current.context, transaction: null }, null);
      }
    },
  };
}
export type CheckoutController = ReturnType<typeof useCheckout>;
