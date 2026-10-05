const appBaseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const checks = [];
const check = (condition, label) => checks.push({ condition, label });

async function post(path, input, sessionId) {
  const response = await fetch(`${appBaseUrl}/api/catalog/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sessionId ? { "x-catalog-session": sessionId } : {}) },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}

const sessionId = (await post("session", {})).body.sessionId;
const makes = await post("discovery", { productType: "tire", scope: "vehicle_makes" }, sessionId);
check(makes.status === 200 && makes.body.options?.length > 0, "descubrimiento de marcas con IDs");
const make = makes.body.options?.[0];
if (!make) throw new Error("El proveedor no devolvió marcas.");
const years = await post("discovery", { productType: "tire", scope: "vehicle_years", makeId: make.id }, sessionId);
check(years.status === 200 && years.body.options?.length > 0, "consulta de años sin año previo");
const year = years.body.options?.[0]?.metadata?.year;
if (!year) throw new Error("El proveedor no devolvió años para la marca descubierta.");
const applications = await post("discovery", { productType: "tire", scope: "vehicle_applications", makeId: make.id, year }, sessionId);
check(applications.status === 200 && applications.body.options?.length > 0, "aplicaciones del contexto descubierto");
const application = applications.body.options?.[0];
if (!application) throw new Error("El proveedor no devolvió aplicaciones para el contexto descubierto.");
const exact = await post("search", { mode: "vehicle", applicationId: application.id }, sessionId);
check(exact.status === 200, "búsqueda por applicationId descubierto");
check(exact.body.resolvedVehicle?.make === make.label, "marca del resultado corresponde al descubrimiento");
check(exact.body.resolvedVehicle?.model === application.label, "aplicación exacta conservada");
check(exact.body.resolvedVehicle?.year === year, "año exacto conservado");
const sizes = new Set(exact.body.resolvedVehicle?.sizes ?? []);
check(Array.isArray(exact.body.tires) && exact.body.tires.every((item) => sizes.has(item.size)), "productos dentro de las medidas devueltas por el proveedor");
const secondSession = (await post("session", {})).body.sessionId;
check((await post("search", { mode: "vehicle", applicationId: application.id }, secondSession)).status === 400, "ID existente de otra sesión rechazado");
check((await post("discovery", { productType: "tire", scope: "vehicle_years", makeId: make.id }, secondSession)).status === 400, "marca existente sin descubrimiento previo rechazada");
check((await post("search", { mode: "vehicle", applicationId: "inexistente" }, sessionId)).status === 400, "ID no descubierto rechazado");
check((await post("search", { mode: "vehicle" }, sessionId)).status === 400, "entrada obligatoria ausente rechazada");

for (const item of checks) console.log(`${item.condition ? "PASS" : "FAIL"}  ${item.label}`);
const failures = checks.filter((item) => !item.condition);
console.log(`${checks.length - failures.length}/${checks.length} comprobaciones de proveedor y procedencia aprobadas.`);
if (failures.length) process.exitCode = 1;
