import { defineTool } from "@nekuda/webmcp-sdk";

import {
  invalidateCatalogExecutions,
  withCatalogExecution,
} from "@/features/webmcp/execution-guard";
import { parseStockCriteria, parseTireSearchCriteria } from "@/lib/catalog-input";
import type { CatalogActions, QuoteQuantityMode } from "@/types/catalog";

let catalogBinding: { actions: CatalogActions; token: symbol } | null = null;

export async function executeSafely<T>(operation: () => T | Promise<T>): Promise<T | {
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

export function getCatalogActions(): CatalogActions {
  if (!catalogBinding) throw new Error("El catálogo visible todavía no está disponible.");
  return catalogBinding.actions;
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
  const token = Symbol("catalog-actions");
  catalogBinding = { actions: nextActions, token };
  return () => {
    if (catalogBinding?.token === token) catalogBinding = null;
  };
}

export const searchTiresTool = defineTool({
  stableKey: "tire.search",
  name: "search_tires",
  title: "Buscar llantas",
  description: "Busca hasta cinco opciones actuales. En mode=vehicle requiere applicationId de discover_catalog. En mode=measure requiere una medida, category o productBrandId descubierto. productBrandId y cityId deben venir de un descubrimiento vigente del mismo contexto.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["vehicle", "measure"] },
      applicationId: { type: "string", description: "ID exacto de una aplicación descubierta" },
      width: { type: "string", description: "Ancho, por ejemplo 225" },
      height: { type: "string", description: "Perfil, por ejemplo 65" },
      rim: { type: "string", description: "Rin, por ejemplo 17" },
      category: {
        type: "string",
        enum: ["01", "02", "03", "04"],
        description: "01 autos, 02 camionetas/SUV, 03 camiones, 04 motos",
      },
      productBrandId: { type: "string", description: "ID exacto de marca de producto descubierta" },
      cityId: { type: "string", description: "ID exacto de ciudad descubierta" },
      quantity: { type: "integer", minimum: 1, maximum: 20 },
      budget: { type: "number", exclusiveMinimum: 0, description: "Presupuesto total con cargos conocidos" },
    },
    required: ["mode"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) =>
      getCatalogActions().search(parseTireSearchCriteria(input), execution)));
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
      cityId: { type: "string", description: "ID exacto de ciudad descubierta" },
      warehouseId: { type: "string", description: "ID exacto de bodega descubierta" },
    },
    required: ["category"],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  intent: "answer",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) =>
      getCatalogActions().summarizeStock(parseStockCriteria(input), execution)));
  },
});

export const selectTireTool = defineTool({
  stableKey: "tire.select",
  name: "select_tire",
  title: "Seleccionar llanta",
  description: "Selecciona una opción de los resultados actuales únicamente cuando el usuario confirme ese producto. Elegir una aplicación de vehículo no confirma un producto.",
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
      tire: getCatalogActions().selectTire(requiredString(input, "tireId"), execution),
    })));
  },
});

export const prepareQuoteTool = defineTool({
  stableKey: "quote.prepare",
  name: "prepare_quote",
  title: "Preparar cotización",
  description: "Calcula subtotal y selecciona la llanta. Requiere que el usuario haya confirmado este producto y la cantidad; elegir una versión del vehículo no es confirmación del producto.",
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
      warehouseId: {
        type: "string",
        description: "ID exacto de un local del stock visible",
      },
    },
    required: ["tireId", "quantity", "quantityMode"],
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  intent: "act",
  async execute(input: Record<string, unknown>) {
    return executeSafely(() => withCatalogExecution((execution) => ({
      quote: getCatalogActions().prepareQuote(
        requiredString(input, "tireId"),
        requiredInteger(input, "quantity"),
        requiredQuantityMode(input),
        typeof input.warehouseId === "string" ? input.warehouseId.trim() : undefined,
        execution,
      ),
    })));
  },
});

export const resetCatalogTool = defineTool({
  stableKey: "catalog.reset",
  name: "reset_catalog",
  title: "Reiniciar búsqueda",
  description: "Limpia resultados, selecciones, localidades, cotizaciones e IDs descubiertos de llantas y baterías, e inicia una nueva sesión de catálogo. No borra la conversación. Tras ejecutarla vuelve a descubrir los IDs necesarios.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: false },
  intent: "act",
  async execute() {
    return executeSafely(() => {
      invalidateCatalogExecutions();
      getCatalogActions().reset();
      return { reset: true };
    });
  },
});

export const baseTireTools = [searchTiresTool, summarizeTireStockTool, resetCatalogTool];
export const resultTireTools = [selectTireTool, prepareQuoteTool];
export const allTireTools = [...baseTireTools, ...resultTireTools];
