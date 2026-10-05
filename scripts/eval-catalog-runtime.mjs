import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export async function loadCatalogRuntime() {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  });
  try {
    const tires = await server.ssrLoadModule("/src/features/webmcp/tools/tires.ts");
    const batteries = await server.ssrLoadModule("/src/features/webmcp/tools/batteries.ts");
    const discovery = await server.ssrLoadModule("/src/features/webmcp/tools/discovery.ts");
    const handoff = await server.ssrLoadModule("/src/features/handoff/webmcp-tool.ts");
    const payments = await server.ssrLoadModule("/src/features/payments/webmcp-tools.ts");
    const tools = [...discovery.allDiscoveryTools, ...tires.allTireTools, ...batteries.allBatteryTools, ...payments.allPaymentTools, handoff.requestAdvisorHandoffTool];
    return { server, tools, tires, payments, load: (path) => server.ssrLoadModule(path), close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export function toolDescriptor(tool) {
  const { name, title, description, inputSchema, annotations } = tool;
  return { name, title, description, inputSchema, annotations };
}

export function validateToolArguments(action, tools) {
  const tool = tools.find((item) => item.name === action.toolName);
  if (!tool) return `Herramienta no descubierta: ${action.toolName}`;
  const schema = tool.inputSchema;
  const input = action.arguments;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Argumentos inválidos";
  for (const key of schema.required ?? []) {
    if (input[key] === undefined) return `Falta argumento requerido: ${key}`;
  }
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties?.[key];
    if (!property) return `Argumento no definido en el contrato: ${key}`;
    if (property.type === "integer" ? !Number.isInteger(value) : property.type === "array" ? !Array.isArray(value) : typeof value !== property.type) {
      return `Tipo inválido: ${key}`;
    }
    if (Array.isArray(value) && ((property.minItems !== undefined && value.length < property.minItems) ||
        (property.maxItems !== undefined && value.length > property.maxItems) ||
        (property.uniqueItems && new Set(value).size !== value.length) ||
        value.some((item) => property.items?.type && typeof item !== property.items.type))) {
      return `Array inválido: ${key}`;
    }
    if (property.enum && !property.enum.includes(value)) return `Enum inválido: ${key}=${value}`;
    if (property.minimum !== undefined && value < property.minimum) return `Valor inferior al mínimo: ${key}`;
    if (property.maximum !== undefined && value > property.maximum) return `Valor superior al máximo: ${key}`;
  }
  return null;
}
