"use client";

import dynamic from "next/dynamic";
import { CheckCircle2, CreditCard, ExternalLink, MapPin, RotateCcw, Store, Truck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatUsd } from "@/lib/catalog-search";
import type { BillingDetails, Fulfillment } from "@/types/payment";
import type { CheckoutController } from "./use-checkout";
import styles from "./payment-dialog.module.css";

const DeliveryMap = dynamic(() => import("./delivery-map"), { ssr: false, loading: () => <div className={styles.mapLoading}>Cargando mapa…</div> });
const emptyBilling: BillingDetails = { fullName: "", identification: "", email: "", phone: "", address: "" };

export function PaymentDialog({ controller, initialFulfillment, productName, total, embedded = false }: {
  controller: CheckoutController;
  initialFulfillment?: Fulfillment;
  productName: string;
  total: number | null;
  embedded?: boolean;
}) {
  const { quote, transaction, checkout, busy, error } = controller;
  const [billing, setBilling] = useState<BillingDetails>(emptyBilling);
  const [deliveryReady, setDeliveryReady] = useState(Boolean(quote?.delivery));
  const formRef = useRef<HTMLFormElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittedRef = useRef<string | null>(null);
  const controllerRef = useRef(controller);
  useEffect(() => { controllerRef.current = controller; }, [controller]);
  const frameName = transaction ? `pagoplux-${transaction.id}` : "pagoplux-checkout";

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);

  useEffect(() => {
    if (transaction?.status === "VALIDATED" && dialogRef.current) dialogRef.current.scrollTop = 0;
  }, [transaction?.status]);

  useEffect(() => {
    if (!checkout?.form || !transaction || transaction.status !== "PENDING" || submittedRef.current === transaction.id) return;
    submittedRef.current = transaction.id;
    formRef.current?.submit();
  }, [checkout, transaction]);

  useEffect(() => {
    if (!transaction?.id || transaction?.mode !== "pagoplux_sandbox" || transaction?.status !== "PENDING") return;
    function receive(event: MessageEvent) {
      // Copied PagoPlux postMessage flow, additionally bound to this exact iframe.
      if (event.origin !== "https://sandbox-paybox.pagoplux.com" || event.source !== frameRef.current?.contentWindow) return;
      let payload: unknown = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      void controllerRef.current.recordReturn(payload);
    }
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => { void controllerRef.current.refreshStatus(); }, 2500);
    return () => { window.removeEventListener("message", receive); window.clearInterval(timer); };
  }, [transaction?.id, transaction?.mode, transaction?.status]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!quote) return;
    let address = billing.address;
    if (quote.fulfillment === "delivery") {
      if (!deliveryReady || !quote.delivery) return;
      address = quote.delivery.address;
    }
    void controller.pay({ ...billing, address });
  }
  const approved = transaction?.status === "VALIDATED";
  const failed = transaction?.status === "DECLINED" || transaction?.status === "CANCELLED";

  return <dialog ref={dialogRef} className={`${styles.dialog} ${embedded ? styles.embedded : ""}`} aria-labelledby="payment-title" onCancel={() => controller.close()}>
    <header className={styles.header}>
      <h2 id="payment-title"><CreditCard size={23} /> {approved ? "Comprobante de pago" : "Pago con tarjeta"}</h2>
      <button type="button" onClick={() => controller.close()} title="Cerrar pago" aria-label="Cerrar pago"><X size={21} /></button>
    </header>
    <div className={styles.content}>
      <div className={styles.summary}>
        <div><strong>{quote?.productName ?? productName}</strong>{quote ? <span>{quote.quantity} {quote.quantity === 1 ? "unidad" : "unidades"} · {quote.fulfillment === "delivery" ? "A domicilio" : quote.pickupLabel}</span> : null}</div>
        <strong>{formatUsd(quote ? quote.totalAmountCents / 100 : total)}</strong>
      </div>
      {!quote ? <div className={styles.fulfillment} aria-label="Retiro o entrega">
        {(!initialFulfillment || initialFulfillment === "pickup") ? <button type="button" disabled={busy} onClick={() => void controller.chooseFulfillment("pickup")}><Store size={20} /> Retirar en local</button> : null}
        {(!initialFulfillment || initialFulfillment === "delivery") ? <button type="button" disabled={busy} onClick={() => void controller.chooseFulfillment("delivery")}><Truck size={20} /> A domicilio</button> : null}
      </div> : null}
      {quote?.fulfillment === "delivery" && !approved ? <DeliveryMap key={quote.id} value={quote.delivery} busy={busy} disabled={Boolean(transaction)}
        onValidityChange={setDeliveryReady} onSave={controller.saveDelivery} resolveAddress={controller.resolveAddress} /> : null}
      {approved ? <section className={styles.receipt} aria-label="Pago aprobado" aria-live="polite">
        <CheckCircle2 size={40} /><h3>Pago aprobado</h3><p>Comprobante {transaction.id}</p>
        {transaction.delivery ? <><p>{transaction.delivery.address}</p><p>{transaction.delivery.reference}</p>
          <a href={`https://www.google.com/maps/search/?api=1&query=${transaction.delivery.latitude},${transaction.delivery.longitude}`} target="_blank" rel="noopener noreferrer"><MapPin size={17} /> Ver ubicación <ExternalLink size={14} /></a></> : null}
        <button type="button" className={styles.primary} onClick={() => controller.close()}>Continuar</button>
      </section> : failed ? <section className={styles.receipt} aria-label="Resultado del pago">
        <h3>{transaction.status === "DECLINED" ? "Tarjeta rechazada" : "Pago cancelado"}</h3>
        <button type="button" className={styles.primary} onClick={() => controller.retry()}><RotateCcw size={17} /> Intentar nuevamente</button>
      </section> : transaction ? transaction.mode === "simulation" ? <section className={styles.cardPayment} aria-label="Pago con tarjeta">
        <div><CreditCard size={29} /><strong>Tarjeta de crédito</strong></div>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void controller.simulate("approved")}><CreditCard size={18} /> Pagar {formatUsd(transaction.totalAmountCents / 100)}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => void controller.simulate("cancelled")}>Cancelar pago</button>
      </section> : <section aria-label="PagoPlux">
        <iframe ref={frameRef} name={frameName} title="PagoPlux" className={styles.paybox} />
        {checkout?.form ? <form ref={formRef} action={checkout.form.action} method="get" target={frameName} hidden>
          {Object.entries(checkout.form.fields).map(([name, value]) => <input key={name} name={name} readOnly value={String(value)} />)}
        </form> : null}
        <button type="button" className={styles.secondary} onClick={() => void controller.refreshStatus()} disabled={busy}><RotateCcw size={17} /> Consultar pago</button>
      </section> : quote ? <form onSubmit={submit} className={styles.billing} aria-label="Datos de facturación">
        <h3>Datos de facturación</h3>
        <div className={styles.fields}>
          {([
            ["fullName", "Nombre completo", "text", "name"], ["identification", "Cédula o RUC", "text", "off"],
            ["email", "Correo", "email", "email"], ["phone", "Teléfono", "tel", "tel"],
            ["address", "Dirección de facturación", "text", "street-address"],
          ] as const).filter(([key]) => key !== "address" || quote.fulfillment !== "delivery").map(([key, label, type, autocomplete]) => <label key={key} className={key === "address" ? styles.billingAddress : undefined}>{label}<input required type={type} autoComplete={autocomplete} maxLength={key === "phone" || key === "identification" ? 30 : 250}
            value={billing[key]} onChange={(event) => setBilling((current) => ({ ...current, [key]: event.target.value }))} disabled={busy} /></label>)}
        </div>
        <button className={styles.primary} disabled={busy || (quote.fulfillment === "delivery" && !deliveryReady)}><CreditCard size={18} /> {busy ? "Procesando…" : `Pagar ${formatUsd(quote.totalAmountCents / 100)}`}</button>
      </form> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  </dialog>;
}
