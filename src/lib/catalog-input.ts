import type {
  TireCategory,
  TireSearchCriteria,
} from "@/types/catalog";

const CATEGORIES = new Set<TireCategory>(["01", "02", "03", "04"]);

export class CatalogInputError extends Error {}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogInputError("La solicitud debe ser un objeto JSON.");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new CatalogInputError(`${label} debe ser texto.`);
  const result = value.trim();
  if (!result || result.length > 160) throw new CatalogInputError(`${label} no es válido.`);
  return result;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value, label);
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
    brand: optionalString(input.brand, "brand"),
    city: optionalString(input.city, "city"),
    quantity,
    budget,
  };

  if (mode === "vehicle") {
    if (category === "04") {
      throw new CatalogInputError("La búsqueda por vehículo no está disponible para motos.");
    }
    const vehicleCategory = category as "01" | "02" | "03" | undefined;
    const year = optionalNumber(input.year, "year");
    if (!Number.isInteger(year) || year! < 1900 || year! > 2100) {
      throw new CatalogInputError("year debe ser un año válido.");
    }
    return {
      mode,
      make: requiredString(input.make, "make"),
      model: requiredString(input.model, "model"),
      year: year!,
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
  if (!result.width && !result.height && !result.rim && !result.category && !result.brand) {
    throw new CatalogInputError("Indica medida, categoría o marca.");
  }
  return result;
}

export function parseStockCriteria(value: unknown): {
  category: TireCategory;
  city?: string;
  warehouse?: string;
} {
  const input = asObject(value);
  const category = optionalCategory(input.category);
  if (!category) throw new CatalogInputError("category es obligatorio.");
  return {
    category,
    city: optionalString(input.city, "city"),
    warehouse: optionalString(input.warehouse, "warehouse"),
  };
}
