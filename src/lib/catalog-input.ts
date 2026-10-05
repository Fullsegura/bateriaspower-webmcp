import type {
  CatalogDiscoveryCriteria,
  CatalogDiscoveryScope,
  ProductKind,
  TireCategory,
  TireSearchCriteria,
} from "@/types/catalog";

const CATEGORIES = new Set<TireCategory>(["01", "02", "03", "04"]);
const PRODUCT_KINDS = new Set<ProductKind>(["tire", "battery"]);
const DISCOVERY_SCOPES = new Set<CatalogDiscoveryScope>([
  "vehicle_makes",
  "vehicle_years",
  "vehicle_applications",
  "product_brands",
  "locations",
]);

export class CatalogInputError extends Error {}

// Application IDs encode provider records, including their complete engine labels.
export const MAX_CATALOG_ID_LENGTH = 4096;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogInputError("La solicitud debe ser un objeto JSON.");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string, maxLength = 160): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new CatalogInputError(`${label} debe ser texto.`);
  const result = value.trim();
  if (!result || result.length > maxLength) throw new CatalogInputError(`${label} no es válido.`);
  return result;
}

function requiredString(value: unknown, label: string, maxLength = 160): string {
  const result = optionalString(value, label, maxLength);
  if (!result) throw new CatalogInputError(`${label} es obligatorio.`);
  return result;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CatalogInputError(`${label} debe ser un número.`);
  }
  return value;
}

function optionalCategory(value: unknown): TireCategory | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !CATEGORIES.has(value as TireCategory)) {
    throw new CatalogInputError("category debe ser 01, 02, 03 o 04.");
  }
  return value as TireCategory;
}

export function parseTireSearchCriteria(value: unknown): TireSearchCriteria {
  const input = asObject(value);
  const mode = input.mode;
  const quantity = optionalNumber(input.quantity, "quantity");
  const budget = optionalNumber(input.budget, "budget");
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 20)) {
    throw new CatalogInputError("quantity debe ser un entero entre 1 y 20.");
  }
  if (budget !== undefined && budget <= 0) {
    throw new CatalogInputError("budget debe ser mayor que cero.");
  }

  const category = optionalCategory(input.category);
  const common = {
    category,
    productBrandId: optionalString(input.productBrandId, "productBrandId", MAX_CATALOG_ID_LENGTH),
    cityId: optionalString(input.cityId, "cityId", MAX_CATALOG_ID_LENGTH),
    quantity,
    budget,
  };
  if ((common.productBrandId || common.cityId) && !category) {
    throw new CatalogInputError("category es obligatorio al usar productBrandId o cityId.");
  }

  if (mode === "vehicle") {
    if (category === "04") {
      throw new CatalogInputError("La búsqueda por vehículo no está disponible para motos.");
    }
    const vehicleCategory = category as "01" | "02" | "03" | undefined;
    return {
      mode,
      applicationId: requiredString(input.applicationId, "applicationId", MAX_CATALOG_ID_LENGTH),
      ...common,
      category: vehicleCategory,
    };
  }

  if (mode !== "measure") {
    throw new CatalogInputError("mode debe ser vehicle o measure.");
  }
  const result: TireSearchCriteria = {
    mode,
    width: optionalString(input.width, "width"),
    height: optionalString(input.height, "height"),
    rim: optionalString(input.rim, "rim"),
    ...common,
  };
  if (!result.width && !result.height && !result.rim && !result.category && !result.productBrandId) {
    throw new CatalogInputError("Indica medida, categoría o marca.");
  }
  return result;
}

export function parseStockCriteria(value: unknown): {
  category: TireCategory;
  cityId?: string;
  warehouseId?: string;
} {
  const input = asObject(value);
  const category = optionalCategory(input.category);
  if (!category) throw new CatalogInputError("category es obligatorio.");
  return {
    category,
    cityId: optionalString(input.cityId, "cityId", MAX_CATALOG_ID_LENGTH),
    warehouseId: optionalString(input.warehouseId, "warehouseId", MAX_CATALOG_ID_LENGTH),
  };
}

export function parseCatalogDiscoveryCriteria(value: unknown): CatalogDiscoveryCriteria {
  const input = asObject(value);
  if (typeof input.productType !== "string" || !PRODUCT_KINDS.has(input.productType as ProductKind)) {
    throw new CatalogInputError("productType debe ser tire o battery.");
  }
  if (typeof input.scope !== "string" || !DISCOVERY_SCOPES.has(input.scope as CatalogDiscoveryScope)) {
    throw new CatalogInputError("scope no es válido.");
  }
  const year = optionalNumber(input.year, "year");
  if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    throw new CatalogInputError("year debe ser un año válido.");
  }
  const criteria: CatalogDiscoveryCriteria = {
    productType: input.productType as ProductKind,
    scope: input.scope as CatalogDiscoveryScope,
    makeId: optionalString(input.makeId, "makeId", MAX_CATALOG_ID_LENGTH),
    year,
    category: optionalCategory(input.category),
    productId: optionalString(input.productId, "productId", MAX_CATALOG_ID_LENGTH),
    cityId: optionalString(input.cityId, "cityId", MAX_CATALOG_ID_LENGTH),
  };
  if ((criteria.scope === "vehicle_years" || criteria.scope === "vehicle_applications") && !criteria.makeId) {
    throw new CatalogInputError("makeId es obligatorio para este descubrimiento.");
  }
  if (criteria.scope !== "locations" && (criteria.productId || criteria.cityId)) {
    throw new CatalogInputError("productId y cityId solo se aplican a locations.");
  }
  if (criteria.productType === "tire" &&
      (criteria.scope === "product_brands" || criteria.scope === "locations") && !criteria.category) {
    throw new CatalogInputError("category es obligatorio para marcas y localidades de llantas.");
  }
  return criteria;
}
