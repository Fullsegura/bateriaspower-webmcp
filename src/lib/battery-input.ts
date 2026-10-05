import type { BatterySearchCriteria } from "@/types/catalog";
import { MAX_CATALOG_ID_LENGTH } from "@/lib/catalog-input";

export class BatteryInputError extends Error {}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BatteryInputError("La solicitud debe ser un objeto JSON.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new BatteryInputError(`${label} es obligatorio.`);
  const result = value.trim();
  if (!result) throw new BatteryInputError(`${label} es obligatorio.`);
  if (result.length > MAX_CATALOG_ID_LENGTH) throw new BatteryInputError(`${label} supera la longitud permitida.`);
  return result;
}

export function parseBatterySearchCriteria(value: unknown): BatterySearchCriteria {
  const input = asObject(value);
  if (typeof input.year !== "number" || !Number.isInteger(input.year) || input.year < 1900 || input.year > 2100) {
    throw new BatteryInputError("year debe ser un año válido.");
  }
  return {
    applicationId: requiredString(input.applicationId, "applicationId"),
    year: input.year,
  };
}

export function parseBatteryAlternatives(value: unknown): { listingId: string; batteryIds: string[] } {
  const input = asObject(value);
  if (Object.keys(input).some((key) => key !== "listingId" && key !== "batteryIds")) {
    throw new BatteryInputError("La solicitud contiene campos desconocidos.");
  }
  if (!Array.isArray(input.batteryIds) || input.batteryIds.length < 1 || input.batteryIds.length > 5) {
    throw new BatteryInputError("batteryIds debe contener entre una y cinco alternativas.");
  }
  const batteryIds = input.batteryIds.map((id) => requiredString(id, "batteryId"));
  if (new Set(batteryIds).size !== batteryIds.length) throw new BatteryInputError("Los IDs deben ser únicos.");
  return { listingId: requiredString(input.listingId, "listingId"), batteryIds };
}
