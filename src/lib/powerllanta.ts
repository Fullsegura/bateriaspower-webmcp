import type {
  CatalogDiscoveryOption,
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

const POWERLLANTA_BASE_URL = "https://durallanta.com";
const POWERLLANTA_SOURCE_NAME = "PowerAuto";
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const CATEGORY_LABELS: Record<TireCategory, string> = {
  "01": "Autos",
  "02": "Camionetas y SUV",
  "03": "Camiones",
  "04": "Motos",
};
type JsonObject = Record<string, unknown>;

interface TireApplicationToken {
  makeId: string;
  make: string;
  yearId: string;
  year: number;
  modelId: string;
  model: string;
}

export class PowerLlantaError extends Error {
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
    throw new PowerLlantaError(`PowerAuto devolvió ${label} inválido.`);
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

function tireBrandId(label: string): string {
  return `tire-brand:${encodeURIComponent(label)}`;
}

function encodeTireApplication(value: TireApplicationToken): string {
  return `tire-application:${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

function decodeTireApplication(applicationId: string): TireApplicationToken {
  const encoded = applicationId.startsWith("tire-application:")
    ? applicationId.slice("tire-application:".length)
    : "";
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TireApplicationToken;
    if (
      !value.makeId || !value.make || !value.yearId || !Number.isInteger(value.year) ||
      !value.modelId || !value.model
    ) throw new Error("invalid");
    return value;
  } catch {
    throw new PowerLlantaError("applicationId no es válido para llantas.", 422);
  }
}

function decodeTireBrandId(brandId: string): string {
  if (!brandId.startsWith("tire-brand:")) {
    throw new PowerLlantaError("productBrandId no es válido para llantas.", 422);
  }
  return decodeURIComponent(brandId.slice("tire-brand:".length));
}

function getResponse(payload: unknown): unknown {
  const root = asObject(payload, "una respuesta");
  const sourceError = asString(root.error);
  if (sourceError) throw new PowerLlantaError(sourceError);
  if (root.response === undefined || root.response === null) {
    throw new PowerLlantaError("PowerAuto devolvió una respuesta vacía.");
  }
  return root.response;
}

async function powerLlantaRequest(
  path: string,
  init?: { method?: "GET" | "POST"; body?: JsonObject },
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${POWERLLANTA_BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PowerLlantaError(
        `PowerAuto respondió HTTP ${response.status}.`,
        502,
      );
    }
    return getResponse(await response.json());
  } catch (error) {
    if (error instanceof PowerLlantaError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new PowerLlantaError("PowerAuto excedió el tiempo de respuesta.", 504);
    }
    throw new PowerLlantaError("No fue posible consultar PowerAuto.");
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
        cityId: cityCode,
        warehouseId: `${cityCode}:${asString(record.codigoBodega)}`,
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
    throw new PowerLlantaError("PowerAuto devolvió una categoría desconocida.");
  }

  const code = asString(product.codigo_producto);
  const name = asString(product.nombre_producto);
  if (!code || !name) {
    throw new PowerLlantaError("PowerAuto devolvió un producto sin identificación.");
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
    brandId: tireBrandId(
      asString(asObject(product.brand ?? {}, "la marca").name) || "Sin marca informada",
    ),
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
      scope: "Todas las bodegas",
      requestedQuantity: 1,
      availableUnits: computedTotal,
      singleWarehouseCanFulfill: warehouses.some((item) => item.quantity >= 1),
      requiresMultipleWarehouses: false,
    },
    image: asString(product.img_principal) || null,
    secondaryImages: [product.img_secundaria1, product.img_secundaria2]
      .map(asString)
      .filter(Boolean),
  };
}

async function getCategoryProducts(category: TireCategory): Promise<Tire[]> {
  const byCode = new Map<string, Tire>();
  for (let start = 0; ; start += PAGE_SIZE) {
    const response = asObject(await powerLlantaRequest("/api/get_products", {
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

export async function discoverTireMakes(): Promise<CatalogDiscoveryOption[]> {
  const parameters = asObject(
    await powerLlantaRequest("/api/get_main_search_parameters"),
    "los parámetros de búsqueda",
  );
  return asArray(parameters.car_brands).map((value) => {
    const record = asObject(value, "una marca de vehículo");
    return { id: asString(record._id), label: asString(record.name) };
  }).filter((option) => option.id && option.label);
}

export async function discoverTireApplications(
  makeId: string,
  year?: number,
): Promise<CatalogDiscoveryOption[]> {
  const makes = await discoverTireMakes();
  const make = makes.find((option) => option.id === makeId);
  if (!make) throw new PowerLlantaError("makeId no pertenece al catálogo de llantas.", 422);
  const yearsResponse = await powerLlantaRequest("/api/get_years_by_car_brand", {
    method: "POST",
    body: { brand: make.id },
  });
  const years = asArray(yearsResponse).map((value) => {
    const record = asObject(value, "un año de vehículo");
    return { id: asString(record._id), year: asNumber(record.year) };
  });
  const selectedYears = years.filter((item) => item.year !== null &&
    (year === undefined || item.year === year));
  const applications: CatalogDiscoveryOption[] = [];
  // Reuse the provider's make/year response when querying all years.
  for (const yearOption of selectedYears) {
    const modelsResponse = await powerLlantaRequest("/api/get_car_models_by_year", {
      method: "POST",
      body: { brand: make.id, year: yearOption.id },
    });
    applications.push(...asArray(modelsResponse).map((value) => {
      const row = asObject(value, "un modelo de vehículo");
      const model = asObject(row.model, "el detalle del modelo");
      const modelId = asString(model._id);
      const modelName = asString(model.name);
      return {
        id: encodeTireApplication({
          makeId: make.id,
          make: make.label,
          yearId: yearOption.id,
          year: yearOption.year!,
          modelId,
          model: modelName,
        }),
        label: modelName,
        metadata: { make: make.label, model: modelName, year: yearOption.year },
      };
    }).filter((option) => option.label && option.id));
  }
  return applications;
}

export async function discoverTireYears(makeId: string): Promise<CatalogDiscoveryOption[]> {
  const make = (await discoverTireMakes()).find((option) => option.id === makeId);
  if (!make) throw new PowerLlantaError("makeId no pertenece al catálogo de llantas.", 422);
  const response = await powerLlantaRequest("/api/get_years_by_car_brand", {
    method: "POST", body: { brand: makeId },
  });
  return asArray(response).map((value) => {
    const record = asObject(value, "un año de vehículo");
    const year = asNumber(record.year);
    return { id: asString(record._id), label: String(year), metadata: { year } };
  }).filter((option) => option.id && option.metadata.year !== null);
}

export async function discoverTireBrands(category: TireCategory): Promise<CatalogDiscoveryOption[]> {
  const products = await getCategoryProducts(category);
  return [...new Map(products.map((product) => [
    product.brandId,
    { id: product.brandId, label: product.brand },
  ])).values()];
}

export async function discoverTireLocations(
  category: TireCategory,
  productId?: string,
  cityId?: string,
): Promise<CatalogDiscoveryOption[]> {
  const products = (await getCategoryProducts(category))
    .filter((product) => !productId || product.id === productId);
  const options = new Map<string, CatalogDiscoveryOption>();
  for (const product of products) {
    for (const warehouse of product.warehouses) {
      if (cityId && warehouse.cityId !== cityId) continue;
      options.set(`city:${warehouse.cityId}`, {
        id: warehouse.cityId,
        label: warehouse.cityCode,
        metadata: { type: "city" },
      });
      options.set(`warehouse:${warehouse.warehouseId}`, {
        id: warehouse.warehouseId,
        label: `${warehouse.cityCode} · ${warehouse.warehouseName}`,
        metadata: {
          type: "warehouse",
          cityId: warehouse.cityId,
          warehouseCode: warehouse.warehouseCode,
          ...(productId ? { quantity: warehouse.quantity } : {}),
        },
      });
    }
  }
  return [...options.values()];
}

async function resolveVehicle(criteria: VehicleSearchCriteria): Promise<{
  resolved: ResolvedVehicle;
  tires: Tire[];
}> {
  const application = decodeTireApplication(criteria.applicationId);
  const makes = await discoverTireMakes();
  const make = makes.find((option) => option.id === application.makeId);
  if (!make || make.label !== application.make) {
    throw new PowerLlantaError("applicationId no corresponde a una marca vigente.", 422);
  }
  const yearsResponse = await powerLlantaRequest("/api/get_years_by_car_brand", {
    method: "POST",
    body: { brand: application.makeId },
  });
  const years = asArray(yearsResponse).map((value) => {
    const record = asObject(value, "un año de vehículo");
    return { id: asString(record._id), year: asNumber(record.year) };
  });
  const year = years.find((item) => item.id === application.yearId && item.year === application.year);
  if (!year) throw new PowerLlantaError("applicationId no corresponde a un año vigente.", 422);

  const modelsResponse = await powerLlantaRequest("/api/get_car_models_by_year", {
    method: "POST",
    body: { brand: application.makeId, year: application.yearId },
  });
  const models = asArray(modelsResponse).map((value) => {
    const row = asObject(value, "un modelo de vehículo");
    const model = asObject(row.model, "el detalle del modelo");
    return { id: asString(model._id), name: asString(model.name) };
  });
  const model = models.find((item) =>
    item.id === application.modelId && item.name === application.model
  );
  if (!model) throw new PowerLlantaError("applicationId no corresponde a un modelo vigente.", 422);

  const tireResponse = await powerLlantaRequest("/api/get_tires_by_car", {
    method: "POST",
    body: {
      brand: application.makeId,
      year: application.yearId,
      model: application.modelId,
    },
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
      const response = asObject(await powerLlantaRequest("/api/search_products", {
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
      make: application.make,
      year: application.year,
      model: model.name,
      sizes: specifications.map(({ width, height, rim }) => `${width}/${height}R${rim}`),
    },
    tires: pages.flat(),
  };
}

async function searchByMeasure(criteria: MeasureSearchCriteria): Promise<Tire[]> {
  if (criteria.category) return getCategoryProducts(criteria.category);
  if (!criteria.width && !criteria.height && !criteria.rim && !criteria.productBrandId) {
    throw new PowerLlantaError("Indica una medida, marca o categoría para buscar.", 400);
  }
  if (criteria.productBrandId && !criteria.width && !criteria.height && !criteria.rim) {
    const response = asObject(await powerLlantaRequest("/api/search_products_by_brand", {
      method: "POST",
      body: { brand: decodeTireBrandId(criteria.productBrandId) },
    }), "los productos por marca");
    return asArray(response.products).map(normalizeProduct);
  }
  const response = asObject(await powerLlantaRequest("/api/search_products", {
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

function scopeProduct(product: Tire, criteria: TireSearchCriteria): Tire | null {
  const width = criteria.mode === "measure" ? criteria.width : undefined;
  const height = criteria.mode === "measure" ? criteria.height : undefined;
  const rim = criteria.mode === "measure" ? criteria.rim : undefined;
  if (criteria.category && product.category !== criteria.category) return null;
  if (width && product.width !== width) return null;
  if (height && product.height !== height) return null;
  if (rim && product.rim !== rim) return null;
  if (criteria.productBrandId && product.brandId !== criteria.productBrandId) return null;

  const requestedCity = product.category === "04" ? "MOTO" : criteria.cityId ?? null;
  const availableWarehouses = requestedCity
    ? product.warehouses.filter((item) => item.cityId === requestedCity)
    : product.warehouses;
  if (criteria.cityId && product.category !== "04" && !availableWarehouses.length) return null;

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
      scope: requestedCity ?? "Todas las bodegas",
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
    source: POWERLLANTA_SOURCE_NAME,
    note: tires.length
      ? "Stock por local."
      : "PowerAuto no reportó opciones que cumplan todos los criterios.",
    resolvedVehicle: result.resolved,
  };
}

export async function summarizeTireStock(input: {
  category: TireCategory;
  cityId?: string;
  warehouseId?: string;
}): Promise<TireStockSummary> {
  const tires = await getCategoryProducts(input.category);
  const requestedCity = input.category === "04" ? "MOTO" : input.cityId ?? null;
  const requestedWarehouse = input.category === "04" ? null : input.warehouseId ?? null;
  const grouped = new Map<string, TireStockGroup>();

  for (const tire of tires) {
    for (const warehouse of tire.warehouses) {
      if (requestedCity && warehouse.cityId !== requestedCity) continue;
      if (
        requestedWarehouse &&
        warehouse.warehouseId !== requestedWarehouse
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
    source: POWERLLANTA_SOURCE_NAME,
    note:
      input.category === "04"
        ? "Inventario de motos en la agrupación MOTO."
        : "Stock por local.",
  };
}
