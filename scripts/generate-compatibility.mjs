import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceDir = join(projectRoot, "data", "bateriasecuador");
const dataOutputDir = join(projectRoot, "src", "data");
const assetOutputDir = join(projectRoot, "public", "products", "bateriasecuador");

const VARIANT_MODEL_MAP = {
  FE: "FULL EQUIPO",
  HP: "HIGH POWER",
  MP: "MEGA POWER",
  HD: "HEAVY DUTY",
};
const VARIANT_LABEL_MAP = {
  "FULL EQUIPO": "Full Equipo",
  "HIGH POWER": "High Power",
  "MEGA POWER": "Mega Power",
  "HEAVY DUTY": "Heavy Duty",
};
const VARIANT_CODE_MAP = Object.fromEntries(
  Object.entries(VARIANT_MODEL_MAP).map(([code, model]) => [model, code]),
);
const CATALOG_CODE_NORMALIZATION = {
  "100DM": "49",
  LN5: "49",
  "31": "66",
};
const BRAND_NORMALIZATION_MAP = {
  volkswagen: "volskwagen",
};

function normalizeCompact(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeMake(value = "") {
  const normalized = normalizeCompact(value);
  return BRAND_NORMALIZATION_MAP[normalized] ?? normalized;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function productId(box, model) {
  return `be-${slug(box)}-${slug(model)}`;
}

function cleanLabel(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseYearRanges(value = "") {
  const ranges = [];
  for (const chunk of String(value ?? "").split(/[;/]/)) {
    const numbers = [...chunk.matchAll(/\d{2,4}/g)].map((match) =>
      Number(match[0]),
    );
    if (!numbers.length) continue;

    let start = numbers[0];
    let end = numbers[1] ?? numbers[0];
    if (start < 100) start = start < 30 ? 2000 + start : 1900 + start;
    if (end < 100) end = end < 30 ? 2000 + end : 1900 + end;
    if (start > end) [start, end] = [end, start];
    ranges.push([start, end]);
  }
  return ranges;
}

function extractPricedBatteryIds(entry, productIndex) {
  const ids = new Set();

  for (let index = 1; index <= 8; index += 1) {
    const rawValue = entry[`caja_${index}`];
    if (!rawValue) continue;

    for (const rawChunk of rawValue.replace(/\n/g, " ").split("-")) {
      const chunk = cleanLabel(rawChunk).toUpperCase();
      if (!chunk) continue;

      const match = chunk.match(/^([A-Z]*\d+[A-Z]*?)\s*(FE|HP|MP|HD)(?:\s|$)/);
      if (!match) continue;

      const originalCode = match[1];
      const box = CATALOG_CODE_NORMALIZATION[originalCode] ?? originalCode;
      const model = VARIANT_MODEL_MAP[match[2]];
      const product = productIndex.get(`${box}::${model}`);
      if (product) ids.add(productId(box, model));
    }
  }

  return [...ids];
}

const [catalogText, pricesText, availableAssets] = await Promise.all([
  readFile(join(sourceDir, "catalogo.json"), "utf8"),
  readFile(join(sourceDir, "precios.json"), "utf8"),
  readdir(assetOutputDir),
]);
const catalogSource = JSON.parse(catalogText);
const pricesSource = JSON.parse(pricesText);

const productIndex = new Map();
for (const collection of ["productos", "tec"]) {
  for (const product of pricesSource[collection] ?? []) {
    const box = cleanLabel(product.caja).toUpperCase();
    const model = cleanLabel(product.modelo).toUpperCase();
    if (box && model) productIndex.set(`${box}::${model}`, product);
  }
}

const assetNames = new Set(availableAssets);
const assetVersions = new Map(
  await Promise.all(
    availableAssets
      .filter((assetName) => /^[a-z0-9]+\.png$/i.test(assetName))
      .map(async (assetName) => [
        assetName,
        createHash("sha256")
          .update(await readFile(join(assetOutputDir, assetName)))
          .digest("hex")
          .slice(0, 12),
      ]),
  ),
);
const batteries = [...productIndex.entries()].map(([key, product]) => {
  const [box, model] = key.split("::");
  const family = VARIANT_LABEL_MAP[model];
  const variantCode = VARIANT_CODE_MAP[model];
  const normalizedImageName = normalizeCompact(box) + ".png";
  const imageDigits = box.replace(/\D/g, "");
  const numericImageName = imageDigits ? imageDigits + ".png" : "";
  const imageName = [normalizedImageName, numericImageName].find(
    (candidate) => candidate && assetNames.has(candidate),
  ) ?? "";
  const dimensions = product.dimensionesTotalesMM;
  const price = product.precioSugeridoUSD;

  return {
    id: productId(box, model),
    code: `${box} ${variantCode}`,
    family,
    name: `${family} ${box}`,
    description: `Batería caja ${box} de la línea ${family}.`,
    capacityAh: product.capacidadCD_Ah_25C,
    cca: product.potenciaArranqueAmperios.cca_minus18C_A,
    polarity: product.polaridad,
    dimensions: `${dimensions.largo} × ${dimensions.ancho} × ${dimensions.alto} mm`,
    reserveCapacityMinutes: product.capacidadReservaMin,
    price: price.total,
    image: imageName
      ? `/products/bateriasecuador/${imageName}?v=${assetVersions.get(imageName)}`
      : null,
  };
});

const compatibility = catalogSource.flatMap((entry) => {
  const batteryIds = extractPricedBatteryIds(entry, productIndex);
  if (!batteryIds.length) return [];

  return parseYearRanges(entry.anio).map(([yearFrom, yearTo]) => ({
    make: cleanLabel(entry.marca),
    model: cleanLabel(entry.modelo),
    yearFrom,
    yearTo,
    engine: cleanLabel(entry.motor),
    batteryIds,
    sourceType: cleanLabel(entry.tipo),
  }));
});

const batteryIds = new Set(batteries.map(({ id }) => id));
if (
  compatibility.some(({ batteryIds: ids }) =>
    ids.some((batteryId) => !batteryIds.has(batteryId)),
  )
) {
  throw new Error("La importación generó referencias de batería inexistentes.");
}

const metadata = {
  sourceCatalog: "data/bateriasecuador/catalogo.json",
  sourcePrices: "data/bateriasecuador/precios.json",
  catalogEntries: catalogSource.length,
  pricedProducts: batteries.length,
  compatibleApplications: compatibility.length,
  vehicleMakes: new Set(
    compatibility.map(({ make }) => normalizeMake(make)),
  ).size,
  vehicleModels: new Set(
    compatibility.map(
      ({ make, model }) => `${normalizeMake(make)}::${normalizeCompact(model)}`,
    ),
  ).size,
  priceNotice: pricesSource.pieDePagina?.notaPrecios ?? null,
};

await mkdir(dataOutputDir, { recursive: true });
await Promise.all([
  writeFile(
    join(dataOutputDir, "batteries.json"),
    `${JSON.stringify(batteries, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    join(dataOutputDir, "compatibility.json"),
    `${JSON.stringify(compatibility, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    join(dataOutputDir, "catalog-metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify(metadata, null, 2));
