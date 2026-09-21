const appBaseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";

const checks = [];

function check(condition, label, detail = "") {
  checks.push({ condition, label, detail });
}

async function postSearch(input) {
  const response = await fetch(`${appBaseUrl}/api/catalog/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no JSON (HTTP ${response.status}): ${text.slice(0, 160)}`);
  }
  return { status: response.status, body };
}

const exactModel = "RAV4 LIMITED AC 2.5 5P 4X4 TA";
const exact = await postSearch({
  mode: "vehicle",
  make: "Toyota",
  model: exactModel,
  year: 2018,
  city: "Quito",
  quantity: 1,
});
check(exact.status === 200, "vehículo exacto responde 200", `HTTP ${exact.status}`);
check(exact.body.resolvedVehicle?.make === "TOYOTA", "marca resuelta por la fuente");
check(exact.body.resolvedVehicle?.model === exactModel, "versión exacta conservada");
check(exact.body.resolvedVehicle?.year === 2018, "año exacto conservado");
const sourceSizes = new Set(exact.body.resolvedVehicle?.sizes ?? []);
check(sourceSizes.size > 0, "PowerLlanta reporta al menos una medida compatible");
check(
  Array.isArray(exact.body.tires) &&
    exact.body.tires.every((tire) =>
      sourceSizes.has(tire.size) &&
      tire.size === `${tire.width}/${tire.height}R${tire.rim}`
    ),
  "ningún producto sale de las medidas compatibles reportadas",
);

const ambiguous = await postSearch({
  mode: "vehicle",
  make: "Toyota",
  model: "RAV4",
  year: 2018,
  city: "Quito",
});
check(ambiguous.status === 422, "modelo ambiguo exige confirmación", `HTTP ${ambiguous.status}`);
check(
  Array.isArray(ambiguous.body.options) && ambiguous.body.options.length > 1,
  "modelo ambiguo devuelve variantes de la fuente",
);
check(!("tires" in ambiguous.body), "modelo ambiguo no devuelve productos");

const uniquePartial = await postSearch({
  mode: "vehicle",
  make: "Toyota",
  model: "RAV4 LIMITED AC 2.5 5P 4X4",
  year: 2018,
});
check(uniquePartial.status === 422, "versión parcial única no se selecciona implícitamente");
check(
  uniquePartial.body.options?.includes(exactModel),
  "versión parcial ofrece la opción registrada para confirmación",
);
check(!("tires" in uniquePartial.body), "versión parcial no devuelve productos");

const partialMake = await postSearch({
  mode: "vehicle",
  make: "Toyot",
  model: exactModel,
  year: 2018,
});
check(partialMake.status === 422, "marca parcial no se selecciona implícitamente");
check(
  partialMake.body.options?.includes("TOYOTA"),
  "marca parcial ofrece la marca registrada para confirmación",
);

const missingModel = await postSearch({
  mode: "vehicle",
  make: "Toyota",
  year: 2018,
});
check(missingModel.status === 400, "consulta sin modelo se rechaza antes de buscar");
check(missingModel.body.detail === "model es obligatorio.", "falta de modelo se explica sin inferirlo");

for (const item of checks) {
  console.log(`${item.condition ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
}

const failures = checks.filter((item) => !item.condition);
console.log(`\n${checks.length - failures.length}/${checks.length} comprobaciones exactas aprobadas.`);
if (failures.length) process.exitCode = 1;
