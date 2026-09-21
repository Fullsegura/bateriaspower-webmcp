"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  catalogReducer,
  createInitialCatalogState,
  runPrepareQuote,
  runSelectTire,
} from "@/features/catalog/catalog-state";
import type {
  CatalogActions,
  CatalogExecutionContext,
  CatalogState,
  QuoteQuantityMode,
  Tire,
  TireSearchCriteria,
  TireSearchResult,
  TireStockSummary,
} from "@/types/catalog";

interface CatalogContextValue {
  state: CatalogState;
  actions: CatalogActions;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function formatCatalogOptions(options: unknown): string {
  if (!Array.isArray(options) || !options.length) return "";
  return ` Opciones:
${options
    .map((option, index) => `${index + 1}. ${String(option)}`)
    .join("\n")}`;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json() as { detail?: string; options?: unknown } & T;
  if (!response.ok) {
    const suffix = formatCatalogOptions(payload.options);
    throw new Error((payload.detail || "La consulta no pudo completarse.") + suffix);
  }
  return payload;
}

function assertCurrent(execution?: CatalogExecutionContext): void {
  if (execution && !execution.isCurrent()) {
    throw new DOMException("La ejecución fue cancelada.", "AbortError");
  }
}

export function CatalogProvider({
  children,
  initialQuery,
}: {
  children: ReactNode;
  initialQuery?: string;
}) {
  const [state, dispatch] = useReducer(
    catalogReducer,
    initialQuery,
    createInitialCatalogState,
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setQuery = useCallback((query: string) => dispatch({ type: "set-query", query }), []);

  const search = useCallback(async (
    criteria: TireSearchCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<TireSearchResult> => {
    const result = await postJson<TireSearchResult>(
      "/api/catalog/search",
      criteria,
      execution?.signal,
    );
    assertCurrent(execution);
    dispatch({ type: "searched", criteria, result });
    return result;
  }, []);

  const summarizeStock = useCallback(async (input: {
    category: "01" | "02" | "03" | "04";
    city?: string;
    warehouse?: string;
  }, execution?: CatalogExecutionContext): Promise<TireStockSummary> => {
    const summary = await postJson<TireStockSummary>(
      "/api/catalog/stock",
      input,
      execution?.signal,
    );
    assertCurrent(execution);
    dispatch({ type: "stock-summary", summary });
    return summary;
  }, []);

  const selectTire = useCallback((
    tireId: string,
    execution?: CatalogExecutionContext,
  ): Tire => {
    assertCurrent(execution);
    const tire = runSelectTire(stateRef.current.tires, tireId);
    dispatch({ type: "select", tireId });
    return tire;
  }, []);

  const prepareQuote = useCallback((
    tireId: string,
    quantity: number,
    quantityMode: QuoteQuantityMode = "total",
    warehouse?: string,
    execution?: CatalogExecutionContext,
  ) => {
    assertCurrent(execution);
    const quote = runPrepareQuote(
      stateRef.current.tires,
      tireId,
      quantity,
      quantityMode,
      warehouse,
      stateRef.current.quote,
    );
    dispatch({ type: "quote", quote });
    return quote;
  }, []);

  const clearQuote = useCallback(() => dispatch({ type: "clear-quote" }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const actions = useMemo<CatalogActions>(() => ({
    setQuery,
    search,
    summarizeStock,
    selectTire,
    prepareQuote,
    clearQuote,
    reset,
  }), [clearQuote, prepareQuote, reset, search, selectTire, setQuery, summarizeStock]);

  return <CatalogContext.Provider value={{ state, actions }}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog debe usarse dentro de CatalogProvider.");
  return context;
}
