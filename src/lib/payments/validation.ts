import type { BillingDetails, DeliveryLocation, PaymentQuoteInput } from "@/types/payment";

export function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Datos inválidos.");
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, name: string, maxLength = 250): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${name} es obligatorio y debe contener como máximo ${maxLength} caracteres.`);
  }
  return value.trim();
}

export function parsePaymentQuoteInput(value: unknown): PaymentQuoteInput {
  const input = inputObject(value);
  if (input.productType !== "tire" && input.productType !== "battery") throw new Error("productType inválido.");
  if (input.fulfillment !== "pickup" && input.fulfillment !== "delivery") throw new Error("Elige retiro o entrega a domicilio.");
  if (typeof input.quantity !== "number" || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) {
    throw new Error("Cantidad inválida.");
  }
  return {
    productType: input.productType,
    productId: requiredText(input.productId, "Producto"),
    fulfillment: input.fulfillment,
    quantity: input.quantity,
    locationId: input.locationId === undefined ? undefined : requiredText(input.locationId, "Localidad"),
    warehouseId: input.warehouseId === undefined ? undefined : requiredText(input.warehouseId, "Local"),
  };
}

export function parseBilling(value: unknown): BillingDetails {
  const input = inputObject(value);
  const billing = {
    fullName: requiredText(input.fullName, "Nombre"),
    identification: requiredText(input.identification, "Identificación", 30),
    email: requiredText(input.email, "Correo"),
    phone: requiredText(input.phone, "Teléfono", 30),
    address: requiredText(input.address, "Dirección"),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email)) throw new Error("Ingresa un correo válido.");
  return billing;
}

export function parseDeliveryLocation(value: unknown): DeliveryLocation {
  const input = inputObject(value);
  if (typeof input.latitude !== "number" || !Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90 ||
      typeof input.longitude !== "number" || !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180) {
    throw new Error("Selecciona una ubicación válida en el mapa.");
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    address: requiredText(input.address, "Dirección de entrega"),
    reference: typeof input.reference === "string" ? input.reference.trim().slice(0, 250) : "",
  };
}
