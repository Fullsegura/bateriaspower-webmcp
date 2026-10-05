import type {
  CatalogDiscoveryContext,
  CatalogDiscoveryCriteria,
  CatalogDiscoveryResult,
  CatalogDiscoveryScope,
  ProductKind,
  TireSearchCriteria,
  BatterySearchCriteria,
  TireCategory,
} from "@/types/catalog";

function contextMatches(
  actual: CatalogDiscoveryContext,
  expected: CatalogDiscoveryContext,
): boolean {
  return Object.entries(expected).every(([key, value]) =>
    value === undefined || actual[key as keyof CatalogDiscoveryContext] === value
  );
}

export class CatalogProvenanceError extends Error {}

export function upsertDiscovery(
  current: CatalogDiscoveryResult[],
  next: CatalogDiscoveryResult,
): CatalogDiscoveryResult[] {
  return [
    ...current.filter((entry) => !(
      entry.productType === next.productType &&
      ((entry.scope === next.scope &&
        JSON.stringify(entry.context) === JSON.stringify(next.context)) ||
       (next.scope === "vehicle_makes" &&
         (entry.scope === "vehicle_years" || entry.scope === "vehicle_applications") &&
         !next.options.some((option) => option.id === entry.context.makeId)))
    )),
    next,
  ];
}

export function requireDiscoveredId(
  discoveries: CatalogDiscoveryResult[],
  productType: ProductKind,
  scope: CatalogDiscoveryScope,
  id: string,
  context: CatalogDiscoveryContext = {},
  metadata: Record<string, string | number | boolean | null> = {},
): void {
  const valid = discoveries.some((entry) =>
    entry.productType === productType &&
    entry.scope === scope &&
    contextMatches(entry.context, context) &&
    entry.options.some((option) =>
      option.id === id &&
      Object.entries(metadata).every(([key, value]) => option.metadata?.[key] === value)
    )
  );
  if (!valid) {
    throw new CatalogProvenanceError(
      `${id} no pertenece a un descubrimiento vigente de ${scope} para este contexto.`,
    );
  }
}

export function requireDiscoveryInputs(
  discoveries: CatalogDiscoveryResult[],
  criteria: CatalogDiscoveryCriteria,
): void {
  if (criteria.makeId) {
    requireDiscoveredId(discoveries, criteria.productType, "vehicle_makes", criteria.makeId);
  }
  if (criteria.cityId) {
    requireDiscoveredId(discoveries, criteria.productType, "locations", criteria.cityId,
      { category: criteria.category, productId: criteria.productId }, { type: "city" });
  }
}

export function requireTireSearchInputs(
  discoveries: CatalogDiscoveryResult[], criteria: TireSearchCriteria,
): void {
  if (criteria.mode === "vehicle") {
    requireDiscoveredId(discoveries, "tire", "vehicle_applications", criteria.applicationId);
  }
  if (criteria.productBrandId) {
    requireDiscoveredId(discoveries, "tire", "product_brands", criteria.productBrandId,
      { category: criteria.category });
  }
  if (criteria.cityId) {
    requireDiscoveredId(discoveries, "tire", "locations", criteria.cityId,
      { category: criteria.category }, { type: "city" });
  }
}

export function requireBatterySearchInputs(
  discoveries: CatalogDiscoveryResult[], criteria: BatterySearchCriteria,
): void {
  const valid = discoveries.some((entry) =>
    entry.productType === "battery" && entry.scope === "vehicle_applications" &&
    (entry.context.year === undefined || entry.context.year === criteria.year) &&
    entry.options.some((option) => option.id === criteria.applicationId &&
      criteria.year >= Number(option.metadata?.yearFrom) &&
      criteria.year <= Number(option.metadata?.yearTo))
  );
  if (!valid) throw new CatalogProvenanceError("applicationId no pertenece al año y contexto descubiertos.");
}

export function requireStockInputs(discoveries: CatalogDiscoveryResult[], input: {
  category: TireCategory; cityId?: string; warehouseId?: string;
}): void {
  if (input.cityId) requireDiscoveredId(discoveries, "tire", "locations", input.cityId,
    { category: input.category }, { type: "city" });
  if (input.warehouseId) requireDiscoveredId(discoveries, "tire", "locations", input.warehouseId,
    { category: input.category }, { type: "warehouse", ...(input.cityId ? { cityId: input.cityId } : {}) });
}
