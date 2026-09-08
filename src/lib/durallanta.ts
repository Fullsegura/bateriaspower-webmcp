import type {
  MeasureSearchCriteria,
  ResolvedVehicle,
  Tire,
  TireCategory,
  TireSearchCriteria,
  TireSearchResult,
  TireStockGroup,
  TireStockSummary,
  TireWarehouseStock,
  VehicleSearchCriteria,
} from "@/types/catalog";

const DURALLANTA_BASE_URL = "https://durallanta.com";
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const CATEGORY_LABELS: Record<TireCategory, string> = {
  "01": "Autos",
  "02": "Camionetas y SUV",
  "03": "Camiones",
  "04": "Motos",
};
const CITY_CODES = new Map([
  ["quito", "UIO"],
  ["uio", "UIO"],
  ["guayaquil", "GYE"],
  ["gye", "GYE"],
  ["cuenca", "CUE"],
  ["cue", "CUE"],
]);

type JsonObject = Record<string, unknown>;

export class DurallantaError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DurallantaError(`Durallanta devolvió ${label} inválido.`);
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function repairMojibake(value: string): string {
  if (!/[ÃÂï¿½]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from([...value], (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

function asString(value: unknown): string {
  if (typeof value === "string") return repairMojibake(value.trim());
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(asString(value));
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]/g, "");
}

function getResponse(payload: unknown): unknown {
  const root = asObject(payload, "una respuesta");
  const sourceError = asString(root.error);
  if (sourceError) throw new DurallantaError(sourceError);
  if (root.response === undefined || root.response === null) {
    throw new DurallantaError("Durallanta devolvió una respuesta vacía.");
  }
  return root.response;
}

async function durallantaRequest(
  path: string,
  init?: { method?: "GET" | "POST"; body?: JsonObject },
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${DURALLANTA_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DurallantaError(
        `Durallanta respondió HTTP ${response.status}.`,
        502,
      );
    }
    return getResponse(await response.json());
  } catch (error) {
    if (error instanceof DurallantaError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DurallantaError("Durallanta excedió el tiempo de respuesta.", 504);
    }
    throw new DurallantaError("No fue posible consultar Durallanta.");
  } finally {
    clearTimeout(timeout);
  }
}

function parseWarehouses(value: unknown): TireWarehouseStock[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const warehouses: TireWarehouseStock[] = [];
  for (const [cityCode, entries] of Object.entries(value)) {
    for (const entry of asArray(entries)) {
      const record = asObject(entry, "stock de bodega");
      const quantity = asNumber(record.cantidad);
      if (quantity === null) continue;
      warehouses.push({
        cityCode,
        warehouseCode: asString(record.codigoBodega),
        warehouseName: asString(record.nombreBodega) || "Bodega sin nombre",
        quantity,
      });
    }
  }
  return warehouses;
}

export function normalizeProduct(value: unknown): Tire {
  const product = asObject(value, "un producto");
  const sourceCategory = asString(product.codigo_segmento);
  const category = (
    sourceCategory === "999" || normalize(asString(product.type)) === "moto"
      ? "04"
      : sourceCategory
  ) as TireCategory;
  if (!(category in CATEGORY_LABELS)) {
    throw new DurallantaError("Durallanta devolvió una categoría desconocida.");
  }

  const code = asString(product.codigo_producto);
  const name = asString(product.nombre_producto);
  if (!code || !name) {
    throw new DurallantaError("Durallanta devolvió un producto sin identificación.");
  }

  const listWithoutVat = asNumber(product.precio);
  const discounted = asNumber(product.precioDescontado);
  const discountedWithEco = asNumber(product.precioDescontadoEcoValor);
  const vatPercent = asNumber(product.iva);
  const finalPrice = asNumber(product.precioFinal);
  const expectedFinal =
    discountedWithEco !== null && vatPercent !== null
      ? discountedWithEco * (1 + vatPercent / 100)
      : null;
  const validPrice =
    listWithoutVat !== null && listWithoutVat > 0 &&
    discounted !== null && discounted > 0 &&
    discountedWithEco !== null && discountedWithEco >= discounted &&
    vatPercent !== null && vatPercent >= 0 &&
    finalPrice !== null && finalPrice > 0 &&
    expectedFinal !== null && Math.abs(expectedFinal - finalPrice) <= 0.02;
  const width = asString(product.ancho);
  const height = asString(product.alto);
  const rim = asString(product.rin);
  const details = asString(product.detalles);
  const warehouses = parseWarehouses(product.stock_bodegas);
  const sourceTotal = asNumber(product.total_stock);
  const computedTotal = warehouses.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: code,
    code,
    name,
    brand: asString(asObject(product.brand ?? {}, "la marca").name) || "Sin marca informada",
    category,
    categoryLabel: CATEGORY_LABELS[category],
    width,
    height,
    rim,
    size: [width, height && `/${height}`, rim && `R${rim}`].filter(Boolean).join(""),
    tread: asString(product.labrado),
    application: asString(product.aplicacion),
    loadDescription: asString(product.descripcion_carga),
    speedDescription: asString(product.descripcion_velocidad),
    details: details.includes("\uFFFD") ? "" : details,
    price: {
      status: validPrice ? "available" : "confirm",
      listWithoutVat: validPrice ? listWithoutVat : null,
      discountPercent: validPrice ? asNumber(product.descuento) : null,
      unitWithoutVat: validPrice ? discounted : null,
      ecoValue:
        validPrice && discountedWithEco !== null
          ? roundMoney(discountedWithEco - discounted)
          : null,
      vatPercent: validPrice ? vatPercent : null,
      unitKnownChargesTotal: validPrice ? finalPrice : null,
    },
    warehouses,
    totalStock: sourceTotal ?? (warehouses.length ? computedTotal : null),
    stockDiscrepancy:
      sourceTotal !== null && Math.abs(sourceTotal - computedTotal) > 0.01
        ? `El total ${sourceTotal} contradice el detalle por bodegas ${computedTotal}.`
        : null,
    availability: {
      scope: "Todas las bodegas reportadas",
      requestedQuantity: 1,
      availableUnits: computedTotal,
      singleWarehouseCanFulfill: warehouses.some((item) => item.quantity >= 1),
      requiresMultipleWarehouses: false,
    },
    image: asString(product.img_principal) || null,
    secondaryImages: [product.img_secundaria1, product.img_secundaria2]
      .map(asString)
      .filter(Boolean),
    sourceUrl: DURALLANTA_BASE_URL,
  };
}

async function getCategoryProducts(category: TireCategory): Promise<Tire[]> {
  const byCode = new Map<string, Tire>();
  for (let start = 0; ; start += PAGE_SIZE) {
    const response = asObject(await durallantaRequest("/api/get_products", {
      method: "POST",
      body: { product_type: category, pag_start: start, pag_end: start + PAGE_SIZE },
    }), "el catálogo");
    const page = asArray(response.products);
    for (const product of page) {
      const normalized = normalizeProduct(product);
      byCode.set(normalized.code, normalized);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return [...byCode.values()];
}

function findExactSourceValue<T>(
  values: T[],
  query: string,
  getLabel: (value: T) => string,
  label: string,
): T {
  const target = normalize(query);
  const exact = values.find((value) => normalize(getLabel(value)) === target);
  if (exact) return exact;

  const partial = values.filter((value) => normalize(getLabel(value)).includes(target));
  const options = partial.length ? partial : values;
  const masculine = label === "modelo";
  const article = masculine ? "El" : "La";
  throw new DurallantaError(
    partial.length > 1
      ? `${article} ${label} es ${masculine ? "ambiguo" : "ambigua"}; selecciona una variante exacta.`
      : partial.length === 1
        ? `${article} ${label} no coincide de forma exacta; confirma la opción registrada.`
        : `Durallanta no reconoce la ${label} solicitada.`,
    422,
    options.slice(0, 20).map(getLabel),
  );
}

async function resolveVehicle(criteria: VehicleSearchCriteria): Promise<{
  resolved: ResolvedVehicle;
  tires: Tire[];
}> {
  const parameters = asObject(
    await durallantaRequest("/api/get_main_search_parameters"),
    "los parámetros de búsqueda",
  );
  const brands = asArray(parameters.car_brands).map((value) => {
    const record = asObject(value, "una marca de vehículo");
    return { id: asString(record._id), name: asString(record.name) };
  });
  const make = findExactSourceValue(brands, criteria.make, (item) => item.name, "marca");

  const yearsResponse = await durallantaRequest("/api/get_years_by_car_brand", {
    method: "POST",
    body: { brand: make.id },
  });
  const years = asArray(yearsResponse).map((value) => {
    const record = asObject(value, "un año de vehículo");
    return { id: asString(record._id), year: asNumber(record.year) };
  });
  const year = years.find((item) => item.year === criteria.year);
  if (!year) {
    throw new DurallantaError(
      `Durallanta no registra ${criteria.make} para el año ${criteria.year}.`,
      422,
      years.map((item) => item.year).filter((value) => value !== null),
    );
  }

  const modelsResponse = await durallantaRequest("/api/get_car_models_by_year", {
    method: "POST",
    body: { brand: make.id, year: year.id },
  });
  const models = asArray(modelsResponse).map((value) => {
    const row = asObject(value, "un modelo de vehículo");
    const model = asObject(row.model, "el detalle del modelo");
    return { id: asString(model._id), name: asString(model.name) };
  });
  const model = findExactSourceValue(models, criteria.model, (item) => item.name, "modelo");

  const tireResponse = await durallantaRequest("/api/get_tires_by_car", {
    method: "POST",
    body: { brand: make.id, year: year.id, model: model.id },
  });
  const specifications = asArray(asObject(asArray(tireResponse)[0] ?? {}, "la compatibilidad").specifications)
    .map((value) => {
      const specification = asObject(value, "una medida compatible");
      return {
        width: asString(specification.width),
        height: asString(specification.high),
        rim: asString(specification.rin),
      };
    })
    .filter((item) => item.width && item.height && item.rim);

  const pages = await Promise.all(
    specifications.map(async (specification) => {
      const response = asObject(await durallantaRequest("/api/search_products", {
        method: "POST",
        body: {
          width: specification.width,
          high: specification.height,
          rin: specification.rim,
          type: "1",
        },
      }), "los productos por medida");
      return asArray(response.products)
        .map(normalizeProduct)
        .filter((tire) =>
          tire.width === specification.width &&
          tire.height === specification.height &&
          tire.rim === specification.rim
        );
    }),
  );

  return {
    resolved: {
      make: make.name,
      year: criteria.year,
      model: model.name,
      sizes: specifications.map(({ width, height, rim }) => `${width}/${height}R${rim}`),
    },
    tires: pages.flat(),
  };
}

async function searchByMeasure(criteria: MeasureSearchCriteria): Promise<Tire[]> {
  if (criteria.category) return getCategoryProducts(criteria.category);
  if (!criteria.width && !criteria.height && !criteria.rim && !criteria.brand) {
    throw new DurallantaError("Indica una medida, marca o categoría para buscar.", 400);
  }
  if (criteria.brand && !criteria.width && !criteria.height && !criteria.rim) {
    const response = asObject(await durallantaRequest("/api/search_products_by_brand", {
      method: "POST",
      body: { brand: criteria.brand },
    }), "los productos por marca");
    return asArray(response.products).map(normalizeProduct);
  }
  const response = asObject(await durallantaRequest("/api/search_products", {
    method: "POST",
    body: {
      width: criteria.width,
      high: criteria.height,
      rin: criteria.rim,
      type: "1",
    },
  }), "los productos por medida");
  return asArray(response.products).map(normalizeProduct);
}

function cityCode(value?: string): string | null {
  if (!value) return null;
  return CITY_CODES.get(normalize(value)) ?? value.trim().toUpperCase();
}

function scopeProduct(product: Tire, criteria: TireSearchCriteria): Tire | null {
  const width = criteria.mode === "measure" ? criteria.width : undefined;
  const height = criteria.mode === "measure" ? criteria.height : undefined;
  const rim = criteria.mode === "measure" ? criteria.rim : undefined;
  if (criteria.category && product.category !== criteria.category) return null;
  if (width && normalize(product.width) !== normalize(width)) return null;
  if (height && normalize(product.height) !== normalize(height)) return null;
  if (rim && normalize(product.rim) !== normalize(rim)) return null;
  if (criteria.brand && !normalize(product.brand).includes(normalize(criteria.brand))) return null;

  const requestedCity = product.category === "04" ? "MOTO" : cityCode(criteria.city);
  const availableWarehouses = requestedCity
    ? product.warehouses.filter((item) => item.cityCode === requestedCity)
    : product.warehouses;
  if (criteria.city && product.category !== "04" && !availableWarehouses.length) return null;

  const quantity = criteria.quantity ?? 1;
  const availableUnits = availableWarehouses.reduce((sum, item) => sum + item.quantity, 0);
  const singleWarehouseCanFulfill = availableWarehouses.some((item) => item.quantity >= quantity);
  if (availableUnits < quantity) return null;
  if (criteria.budget !== undefined) {
    const total = product.price.unitKnownChargesTotal;
    if (total === null || total * quantity > criteria.budget) return null;
  }
  return {
    ...product,
    warehouses: availableWarehouses,
    availability: {
      scope: requestedCity ?? "Todas las bodegas reportadas",
      requestedQuantity: quantity,
      availableUnits,
      singleWarehouseCanFulfill,
      requiresMultipleWarehouses: !singleWarehouseCanFulfill && availableUnits >= quantity,
    },
  };
}

function sortProducts(products: Tire[]): Tire[] {
  return products.toSorted((left, right) => {
    const leftPrice = left.price.unitKnownChargesTotal ?? Number.POSITIVE_INFINITY;
    const rightPrice = right.price.unitKnownChargesTotal ?? Number.POSITIVE_INFINITY;
    return leftPrice - rightPrice || (right.totalStock ?? -1) - (left.totalStock ?? -1);
  });
}

export async function searchTires(criteria: TireSearchCriteria): Promise<TireSearchResult> {
  const queriedAt = new Date().toISOString();
  const result = criteria.mode === "vehicle"
    ? await resolveVehicle(criteria)
    : { resolved: undefined, tires: await searchByMeasure(criteria) };
  const unique = new Map(result.tires.map((tire) => [tire.code, tire]));
  const tires = sortProducts(
    [...unique.values()].flatMap((tire) => {
      const scoped = scopeProduct(tire, criteria);
      return scoped ? [scoped] : [];
    }),
  ).slice(0, 5);

  return {
    tires,
    queriedAt,
    source: DURALLANTA_BASE_URL,
    note: tires.length
      ? "Stock reportado al momento de la consulta; no constituye una reserva."
      : "Durallanta no reportó opciones que cumplan todos los criterios.",
    resolvedVehicle: result.resolved,
  };
}

export async function summarizeTireStock(input: {
  category: TireCategory;
  city?: string;
  warehouse?: string;
}): Promise<TireStockSummary> {
  const tires = await getCategoryProducts(input.category);
  const requestedCity = input.category === "04" ? "MOTO" : cityCode(input.city);
  const requestedWarehouse = input.category === "04" ? null : normalize(input.warehouse ?? "");
  const grouped = new Map<string, TireStockGroup>();

  for (const tire of tires) {
    for (const warehouse of tire.warehouses) {
      if (requestedCity && warehouse.cityCode !== requestedCity) continue;
      if (
        requestedWarehouse &&
        normalize(warehouse.warehouseCode) !== requestedWarehouse &&
        normalize(warehouse.warehouseName) !== requestedWarehouse
      ) continue;
      const key = `${warehouse.cityCode}|${warehouse.warehouseCode}|${warehouse.warehouseName}`;
      const current = grouped.get(key) ?? { ...warehouse, productCount: 0 };
      current.quantity += grouped.has(key) ? warehouse.quantity : 0;
      current.productCount += 1;
      grouped.set(key, current);
    }
  }

  const groups = [...grouped.values()].toSorted((a, b) => b.quantity - a.quantity);
  return {
    category: input.category,
    groups,
    totalUnits: groups.reduce((sum, group) => sum + group.quantity, 0),
    queriedAt: new Date().toISOString(),
    source: DURALLANTA_BASE_URL,
    note:
      input.category === "04"
        ? "Motos usa automáticamente la única agrupación MOTO reportada por Durallanta."
        : "Stock reportado al momento de la consulta; no constituye una reserva.",
  };
}
