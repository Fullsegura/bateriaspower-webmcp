import { createQuote, requireTire } from "@/lib/catalog-search";
import type {
  CatalogState,
  Quote,
  QuoteQuantityMode,
  Tire,
  TireSearchCriteria,
  TireSearchResult,
  TireStockSummary,
} from "@/types/catalog";

export type CatalogAction =
  | { type: "set-query"; query: string }
  | { type: "searched"; criteria: TireSearchCriteria; result: TireSearchResult }
  | { type: "stock-summary"; summary: TireStockSummary }
  | { type: "select"; tireId: string }
  | { type: "quote"; quote: Quote }
  | { type: "clear-quote" }
  | { type: "reset" };

export function createInitialCatalogState(
  query = "Toyota RAV4 2018 en Quito",
): CatalogState {
  return {
    query,
    criteria: null,
    tires: [],
    selectedTireId: null,
    quote: null,
    stockSummary: null,
    queriedAt: null,
  };
}

export function catalogReducer(state: CatalogState, action: CatalogAction): CatalogState {
  switch (action.type) {
    case "set-query":
      return { ...state, query: action.query };
    case "searched":
      return {
        ...state,
        criteria: action.criteria,
        tires: action.result.tires,
        selectedTireId: null,
        quote: null,
        stockSummary: null,
        queriedAt: action.result.queriedAt,
      };
    case "stock-summary":
      return { ...state, stockSummary: action.summary, queriedAt: action.summary.queriedAt };
    case "select":
      return { ...state, selectedTireId: action.tireId, quote: null };
    case "quote":
      return { ...state, selectedTireId: action.quote.tireId, quote: action.quote };
    case "clear-quote":
      return { ...state, quote: null };
    case "reset":
      return { ...createInitialCatalogState(), query: "" };
  }
}

export function runSelectTire(tires: Tire[], tireId: string): Tire {
  return requireTire(tires, tireId);
}

export function runPrepareQuote(
  tires: Tire[],
  tireId: string,
  quantity: number,
  quantityMode: QuoteQuantityMode = "total",
  warehouse?: string,
  currentQuote: Quote | null = null,
): Quote {
  if (quantityMode === "additional") {
    if (!currentQuote || currentQuote.tireId !== tireId) {
      throw new Error("No existe una cotización de esta llanta a la cual sumar unidades.");
    }
    return createQuote(
      tires,
      tireId,
      currentQuote.quantity + quantity,
      warehouse ?? currentQuote.warehouse?.warehouseName,
    );
  }
  const preservedWarehouse =
    !warehouse && currentQuote?.tireId === tireId
      ? currentQuote.warehouse?.warehouseName
      : undefined;
  return createQuote(tires, tireId, quantity, warehouse ?? preservedWarehouse);
}
