import type { CatalogActions } from "@/types/catalog";

function textResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function asString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} es obligatorio.`);
  }
  return value.trim();
}

function asInteger(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${key} debe ser un número entero.`);
  }
  return value;
}

export async function registerBatteryTools(
  modelContext: WebMCP.ModelContext,
  actions: CatalogActions,
  signal: AbortSignal,
): Promise<void> {
  const tools: WebMCP.ModelContextTool[] = [
    {
      name: "search_vehicle_batteries",
      title: "Buscar baterías por vehículo",
      description:
        "Busca baterías compatibles usando marca, modelo, año y motor del vehículo.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          make: { type: "string", description: "Marca del vehículo" },
          model: { type: "string", description: "Modelo del vehículo" },
          year: { type: "integer", minimum: 1900, maximum: 2100 },
          engine: { type: "string", description: "Motor, por ejemplo 1.8" },
        },
        required: ["make", "model", "year"],
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const results = actions.search({
          make: asString(input, "make"),
          model: asString(input, "model"),
          year: asInteger(input, "year"),
          engine:
            typeof input.engine === "string" && input.engine.trim()
              ? input.engine.trim()
              : undefined,
        });
        return textResult({ batteries: results });
      },
    },
    {
      name: "show_battery_results",
      title: "Mostrar resultados",
      description:
        "Muestra en el catálogo las baterías identificadas por una búsqueda previa.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          batteryIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
        required: ["batteryIds"],
      },
      execute: (input) => {
        if (
          !Array.isArray(input.batteryIds) ||
          !input.batteryIds.every((id) => typeof id === "string")
        ) {
          throw new Error("batteryIds debe ser una lista de identificadores.");
        }
        return textResult({ batteries: actions.showResults(input.batteryIds) });
      },
    },
    {
      name: "select_battery",
      title: "Seleccionar batería",
      description: "Selecciona una batería válida y abre su detalle en la interfaz.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { batteryId: { type: "string" } },
        required: ["batteryId"],
      },
      execute: (input) =>
        textResult({ battery: actions.selectBattery(asString(input, "batteryId")) }),
    },
    {
      name: "prepare_quote",
      title: "Preparar cotización",
      description:
        "Calcula una cotización informativa sin crear pedidos, cobros ni efectos externos.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          batteryId: { type: "string" },
          quantity: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["batteryId", "quantity"],
      },
      execute: (input) =>
        textResult({
          quote: actions.prepareQuote(
            asString(input, "batteryId"),
            asInteger(input, "quantity"),
          ),
        }),
    },
    {
      name: "reset_search",
      title: "Reiniciar búsqueda",
      description: "Limpia búsqueda, selección y cotización de la interfaz.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: () => {
        actions.reset();
        return textResult({ reset: true });
      },
    },
  ];

  await Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, { signal })),
  );
}
