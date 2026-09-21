import { defineTool } from "@nekuda/webmcp-sdk";

import {
  invalidateCatalogExecutions,
  withCatalogExecution,
} from "@/features/webmcp/execution-guard";
import { parseStockCriteria, parseTireSearchCriteria } from "@/lib/catalog-input";
import type { CatalogActions, QuoteQuantityMode } from "@/types/catalog";

let catalogActions: CatalogActions | null = null;

async function executeSafely<T>(operation: () => T | Promise<T>): Promise<T | {
  ok: false;
  error: string;
}> {
  try {
    return await operation();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? error.message
        : "La herramienta no pudo completar la solicitud.",
    };
  }
}

function actions(): CatalogActions {
  if (!catalogActions) throw new Error("El catálogo visible todavía no está disponible.");
  return catalogActions;
}

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

function requiredQuantityMode(input: Record<string, unknown>): QuoteQuantityMode {
  const value = input.quantityMode;
  if (value !== "total" && value !== "additional") {
    throw new Error("quantityMode debe ser total o additional.");
  }
  return value;
}

export function bindCatalogActions(nextActions: CatalogActions): () => void {
  catalogActions = nextActions;
  return () => {
    if (catalogActions === nextActions) catalogActions = null;
  };
}

export const searchTiresTool = defineTool({
  stableKey: "tire.search",
  name: "search_tires",
  title: "Buscar llantas",
  description: "Busca hasta cinco opciones actuales y las muestra.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["vehicle", "measure"] },
      make: { type: "string", description: "Marca del vehículo" },
      year: { type: "integer", minimum: 1900, maximum: 2100 },
      model: { type: "string", description: "Modelo y variante exacta" },
      width: { type: "string", description: "Ancho, por ejemplo 225" },
      height: { type: "string", description: "Perfil, por ejemplo 65" },
      rim: { type: "string", description: "Rin, por ejemplo 17" },
      category: {
        type: "string",
        enum: ["01", "02", "03", "04"],
        description: "01 autos, 02 camionetas/SUV, 03 camiones, 04 motos",
      },
      brand: { type: "string", description: "Marca de la llanta" },
      city: { type: "string", description: "Quito, Guayaquil o Cuenca" },
      quantity: { type: "integer", minimum: 1, maximum: 20 },
      budget: { type: "number", exclusiveMinimum: 0, description: "Presupuesto total con cargos conocidos" },
    },
    required: ["mode"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) =>
      actions().search(parseTireSearchCriteria(input), execution)));
  },
});

export const summarizeTireStockTool = defineTool({
  stableKey: "tire.stock_summary",
  name: "summarize_tire_stock",
  title: "Consultar stock de llantas",
  description: "Responde agregados por categoría, ciudad o bodega.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category: {
        type: "string",
        enum: ["01", "02", "03", "04"],
        description: "01 autos, 02 camionetas/SUV, 03 camiones, 04 motos",
      },
      city: { type: "string", description: "Quito, Guayaquil o Cuenca" },
      warehouse: { type: "string", description: "Código o nombre exacto de bodega" },
    },
    required: ["category"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) =>
      actions().summarizeStock(parseStockCriteria(input), execution)));
  },
});

export const selectTireTool = defineTool({
  stableKey: "tire.select",
  name: "select_tire",
  title: "Seleccionar llanta",
  description: "Selecciona una opción sin reservarla.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { tireId: { type: "string" } },
    required: ["tireId"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  intent: "act",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => ({
      tire: actions().selectTire(requiredString(input, "tireId"), execution),
    })));
  },
});

export const prepareQuoteTool = defineTool({
  stableKey: "quote.prepare",
  name: "prepare_quote",
  title: "Preparar cotización",
  description: "Calcula subtotal informativo sin comprar ni reservar.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      tireId: { type: "string" },
      quantity: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Unidades indicadas por el usuario",
      },
      quantityMode: {
        type: "string",
        enum: ["total", "additional"],
        description: "total fija la cantidad final; additional suma unidades a la cotización actual",
      },
      warehouse: {
        type: "string",
        description: "Código o nombre exacto del local solicitado",
      },
    },
    required: ["tireId", "quantity", "quantityMode"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  intent: "act",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => ({
      quote: actions().prepareQuote(
        requiredString(input, "tireId"),
        requiredInteger(input, "quantity"),
        requiredQuantityMode(input),
        typeof input.warehouse === "string" ? input.warehouse.trim() : undefined,
        execution,
      ),
    })));
  },
});

export const resetTireSearchTool = defineTool({
  stableKey: "tire.reset",
  name: "reset_tire_search",
  title: "Reiniciar búsqueda",
  description: "Limpia el estado visible.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: false },
  intent: "act",
  async execute() {
    return executeSafely(() => {
      invalidateCatalogExecutions();
      actions().reset();
      return { reset: true };
    });
  },
});

export const baseTireTools = [searchTiresTool, summarizeTireStockTool, resetTireSearchTool];
export const resultTireTools = [selectTireTool, prepareQuoteTool];
export const allTireTools = [...baseTireTools, ...resultTireTools];
