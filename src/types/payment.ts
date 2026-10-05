import type { ProductKind } from "@/types/catalog";

export type Fulfillment = "pickup" | "delivery";
export type PaymentMode = "simulation" | "pagoplux_sandbox";
export type PaymentStatus = "PENDING" | "VALIDATED" | "DECLINED" | "CANCELLED";

export interface DeliveryLocation {
  latitude: number;
  longitude: number;
  address: string;
  reference: string;
}

export interface BillingDetails {
  fullName: string;
  identification: string;
  email: string;
  phone: string;
  address: string;
}

export interface PaymentQuoteInput {
  productType: ProductKind;
  productId: string;
  quantity: number;
  fulfillment: Fulfillment;
  locationId?: string;
  warehouseId?: string;
}

export interface PaymentQuote extends PaymentQuoteInput {
  id: string;
  productName: string;
  totalAmountCents: number;
  currency: "USD";
  pickupLabel: string | null;
  delivery: DeliveryLocation | null;
  expiresAt: string;
}

export interface PaymentTransaction {
  id: string;
  quoteId: string;
  status: PaymentStatus;
  mode: PaymentMode;
  totalAmountCents: number;
  currency: "USD";
  productName: string;
  quantity: number;
  fulfillment: Fulfillment;
  pickupLabel: string | null;
  delivery: DeliveryLocation | null;
}

export interface PaymentCheckout {
  transaction: PaymentTransaction;
  form: { action: string; fields: Record<string, string | boolean> } | null;
}

export interface CheckoutContext {
  quote: PaymentQuote | null;
  transaction: PaymentTransaction | null;
}
