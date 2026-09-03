import batteriesData from "@/data/batteries.json";
import catalogMetadataData from "@/data/catalog-metadata.json";
import compatibilityData from "@/data/compatibility.json";
import type {
  Battery,
  Compatibility,
  Quote,
  VehicleCriteria,
} from "@/types/catalog";

export const batteries = batteriesData as Battery[];
export const compatibility = compatibilityData as Compatibility[];
export const catalogMetadata = catalogMetadataData;

const batteryById = new Map(batteries.map((battery) => [battery.id, battery]));
const brandNormalization = new Map([["volkswagen", "volskwagen"]]);

function normalizeCompact(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeMake(value: string): string {
  const normalized = normalizeCompact(value);
  return brandNormalization.get(normalized) ?? normalized;
}

function matchesFlexible(query: string, candidate: string): boolean {
  return Boolean(query && candidate) && (
    candidate.includes(query) || query.includes(candidate)
  );
}

export function getBatteryById(id: string): Battery | null {
  return batteryById.get(id) ?? null;
}

export function requireBattery(id: string): Battery {
  const battery = getBatteryById(id);
  if (!battery) {
    throw new Error(`La batería ${id} no existe en el catálogo.`);
  }
  return battery;
}

export function getBatteriesByIds(ids: string[]): Battery[] {
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.map(requireBattery);
}

export function searchVehicleBatteries(
  criteria: VehicleCriteria,
): Battery[] {
  if (
    !Number.isInteger(criteria.year) ||
    criteria.year < 1900 ||
    criteria.year > 2100
  ) {
    throw new Error("El año del vehículo no es válido.");
  }

  const make = normalizeMake(criteria.make);
  const model = normalizeCompact(criteria.model);
  const engine = criteria.engine
    ? normalizeCompact(criteria.engine)
    : null;

  const matches = compatibility.filter((entry) => {
    const entryModel = normalizeCompact(entry.model);
    const entryEngine = normalizeCompact(entry.engine);
    const engineMatches =
      !engine ||
      (Boolean(entryEngine) && (
        entryEngine.includes(engine) ||
        engine.includes(entryEngine)
      ));

    return (
      normalizeMake(entry.make) === make &&
      matchesFlexible(model, entryModel) &&
      criteria.year >= entry.yearFrom &&
      criteria.year <= entry.yearTo &&
      engineMatches
    );
  });

  return getBatteriesByIds(matches.flatMap((entry) => entry.batteryIds));
}

export function createQuote(batteryId: string, quantity: number): Quote {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("La cantidad debe ser un entero entre 1 y 20.");
  }

  const battery = requireBattery(batteryId);
  return {
    batteryId,
    quantity,
    unitPrice: battery.price,
    total: Number((battery.price * quantity).toFixed(2)),
  };
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}
