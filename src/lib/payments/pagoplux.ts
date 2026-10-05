import { timingSafeEqual } from "node:crypto";
import type { BillingDetails, PaymentCheckout, PaymentQuote, PaymentTransaction } from "@/types/payment";

// Provider contract copied from fullseguraAgentesIA/apps/api/src/lib/payments/pagoplux.ts
// and apps/api/src/app/api/payments/pagoplux/checkout/route.ts; no balance/topup logic.
export function getPagoPluxPostUrl(): string {
  return "https://sandbox-paybox.pagoplux.com/movil.html";
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildPagoPluxPackage(totalCents: number) {
  const taxableBaseCents = Math.round(totalCents / (1 + 0.15));
  return { taxableBaseCents, ivaCents: totalCents - taxableBaseCents, totalCents };
}

export function buildPagoPluxForm(
  transaction: PaymentTransaction,
  quote: PaymentQuote,
  billing: BillingDetails,
): NonNullable<PaymentCheckout["form"]> {
  const merchantEmail = process.env.PAGOPLUX_MERCHANT_EMAIL?.trim();
  if (!merchantEmail) throw new Error("Falta configurar PAGOPLUX_MERCHANT_EMAIL.");
  const price = buildPagoPluxPackage(quote.totalAmountCents);
  return {
    action: getPagoPluxPostUrl(),
    fields: {
      PayboxRemail: merchantEmail,
      PayboxSendmail: billing.email,
      PayboxRename: "PowerAuto",
      PayboxSendname: billing.fullName,
      PayboxDescription: `${quote.productName} - ${transaction.id}`,
      PayboxBase0: centsToDecimalString(price.taxableBaseCents),
      PayboxBase12: centsToDecimalString(price.ivaCents),
      PayboxDirection: billing.address,
      PayBoxClientIdentification: billing.identification,
      PayBoxClientPhone: billing.phone,
      PayboxLanguage: "es",
      PayboxProduction: false,
      PayboxEnvironment: "sandbox",
      PayboxExtras: transaction.id,
    },
  };
}

export function normalizeProviderId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeMoneyToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  return null;
}

export type PagoPluxPayload = Record<string, unknown>;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const PAID_WEBHOOK_STATES = new Set(["PAGADO", "PAID", "APPROVED", "APROBADO", "SUCCESS"]);

export function isPaidWebhookPayload(payload: PagoPluxPayload): boolean {
  const state = normalizeProviderId(payload.state)?.toUpperCase();
  const status = normalizeProviderId(payload.status)?.toUpperCase();
  return normalizeProviderId(payload.code) === "0" || Boolean(
    (state && PAID_WEBHOOK_STATES.has(state)) || (status && PAID_WEBHOOK_STATES.has(status)),
  );
}

function metadataTransactionId(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = normalizeProviderId((value as PagoPluxPayload).paymentTransactionId);
    if (id && UUID_PATTERN.test(id)) return id.match(UUID_PATTERN)![0];
  }
  const raw = normalizeProviderId(value);
  if (!raw) return null;
  for (const candidate of [raw, Buffer.from(raw, "base64").toString("utf8")]) {
    const match = candidate.match(UUID_PATTERN)?.[0];
    if (match) return match;
  }
  return null;
}

export function getWebhookPayloadTransactionId(payload: PagoPluxPayload): string | null {
  for (const field of ["metadata", "PayboxExtras", "payboxExtras", "extras", "detail", "description", "descripcion"]) {
    const id = metadataTransactionId(payload[field]);
    if (id) return id;
  }
  return null;
}

export function timingSafeBasicAuthMatches(authorization: string | null): boolean {
  const configured = process.env.PAGOPLUX_WEBHOOK_BASIC_TOKEN;
  if (!configured || !authorization?.startsWith("Basic ")) return false;
  const received = Buffer.from(authorization.slice(6).trim());
  const expected = Buffer.from(configured);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function isPagoPluxOrigin(origin: string): boolean {
  return origin === "https://sandbox-paybox.pagoplux.com";
}
