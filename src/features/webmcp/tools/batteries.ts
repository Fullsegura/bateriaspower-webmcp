import { defineTool } from "@nekuda/webmcp-sdk";

import { withCatalogExecution } from "@/features/webmcp/execution-guard";
import { executeSafely, getCatalogActions } from "@/features/webmcp/tools/tires";
import { parseBatteryAlternatives, parseBatterySearchCriteria } from "@/lib/battery-input";

export const readBatteryCatalogTool = defineTool({
  stableKey: "battery.read_catalog", name: "read_battery_catalog", title: "Consultar fichas de baterías",
  description: "Devuelve las fichas locales con IDs, Ah, CCA, dimensiones, polaridad y precio para que tú compares según las especificaciones respaldadas o la petición del usuario. No requiere vehículo ni prueba compatibilidad. No filtra ni decide similitud. Devuelve listingId para presentar alternativas; reutiliza uiState.batteryListing vigente.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, untrustedContentHint: true }, intent: "answer",
  async execute() {
    return executeSafely(() => withCatalogExecution((execution) => getCatalogActions().readBatteryCatalog(execution)));
  },
});

export const presentBatteryAlternativesTool = defineTool({
  stableKey: "battery.present_alternatives", name: "present_battery_alternatives", title: "Mostrar alternativas de baterías",
  description: "Muestra entre una y cinco baterías que tú elegiste al comparar sus fichas. Requiere listingId y batteryIds de read_battery_catalog vigente en esta sesión. Mantiene tu orden; no selecciona ni cotiza productos, ni verifica compatibilidad con vehículos. Devuelve fichas completas con localidades e inventario.",
  inputSchema: {
    type: "object", additionalProperties: false,
    properties: { listingId: { type: "string" }, batteryIds: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: { type: "string" } } },
    required: ["listingId", "batteryIds"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true }, intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => {
      const { listingId, batteryIds } = parseBatteryAlternatives(input);
      return withCatalogExecution((execution) =>
        getCatalogActions().presentBatteryAlternatives(listingId, batteryIds, execution));
    });
  },
});

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} es obligatorio.`);
  return value.trim();
}

function requiredInteger(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${key} debe ser un número entero.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} debe ser texto.`);
  return value.trim();
}

export const searchVehicleBatteriesTool = defineTool({
  stableKey: "battery.search_vehicle",
  name: "search_vehicle_batteries",
  title: "Buscar baterías por vehículo",
  description: "Busca hasta cinco baterías mediante un applicationId exacto devuelto por discover_catalog para vehicle_applications. Requiere el año usado en ese descubrimiento.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      applicationId: { type: "string", description: "ID exacto de una aplicación descubierta en la sesión" },
      year: { type: "integer", minimum: 1900, maximum: 2100 },
    },
    required: ["applicationId", "year"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) =>
      getCatalogActions().searchBatteries(parseBatterySearchCriteria(input), execution)));
  },
});

export const selectBatteryTool = defineTool({
  stableKey: "battery.select",
  name: "select_battery",
  title: "Seleccionar batería",
  description: "Selecciona una batería de los resultados actuales solo después de que el usuario confirme ese producto. Elegir una aplicación de vehículo no confirma una batería alternativa. Si también indicó una localidad, guarda su ID exacto.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      batteryId: { type: "string" },
      locationId: { type: "string", description: "ID exacto de una localidad del producto visible" },
    },
    required: ["batteryId"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  intent: "act",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => ({
      battery: getCatalogActions().selectBattery(
        requiredString(input, "batteryId"),
        optionalString(input, "locationId"),
        execution,
      ),
    })));
  },
});

export const prepareBatteryQuoteTool = defineTool({
  stableKey: "battery.quote",
  name: "prepare_battery_quote",
  title: "Preparar cotización de batería",
  description: "Prepara una cotización y selecciona la batería; requiere que el usuario confirme este producto, la cantidad y la localidad. Elegir una aplicación de vehículo no confirma una batería alternativa. Valida inventario. La localidad puede ser un punto de retiro o A domicilio.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      batteryId: { type: "string" },
      quantity: { type: "integer", minimum: 1, maximum: 20 },
      locationId: { type: "string", description: "ID exacto de la localidad visible elegida, incluida A domicilio" },
    },
    required: ["batteryId", "quantity", "locationId"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  intent: "act",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => ({
      quote: getCatalogActions().prepareBatteryQuote(
        requiredString(input, "batteryId"),
        requiredInteger(input, "quantity"),
        requiredString(input, "locationId"),
        execution,
      ),
    })));
  },
});

export const allBatteryTools = [
  searchVehicleBatteriesTool,
  selectBatteryTool,
  prepareBatteryQuoteTool,
  readBatteryCatalogTool,
  presentBatteryAlternativesTool,
];
