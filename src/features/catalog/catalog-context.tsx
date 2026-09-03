"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import {
  catalogReducer,
  createInitialCatalogState,
  runPrepareQuote,
  runSearch,
  runSelectBattery,
  runShowResults,
} from "@/features/catalog/catalog-state";
import type {
  Battery,
  CatalogActions,
  CatalogState,
  Quote,
  VehicleCriteria,
} from "@/types/catalog";

interface CatalogContextValue {
  state: CatalogState;
  actions: CatalogActions;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    catalogReducer,
    undefined,
    createInitialCatalogState,
  );

  const setQuery = useCallback((query: string) => {
    dispatch({ type: "set-query", query });
  }, []);

  const search = useCallback((criteria: VehicleCriteria): Battery[] => {
    const results = runSearch(criteria);
    dispatch({
      type: "searched",
      criteria,
      resultIds: results.map((battery) => battery.id),
    });
    return results;
  }, []);

  const showResults = useCallback((batteryIds: string[]): Battery[] => {
    const results = runShowResults(batteryIds);
    dispatch({
      type: "show-results",
      resultIds: results.map((battery) => battery.id),
    });
    return results;
  }, []);

  const selectBattery = useCallback((batteryId: string): Battery => {
    const battery = runSelectBattery(batteryId);
    dispatch({ type: "select", batteryId });
    return battery;
  }, []);

  const prepareQuote = useCallback(
    (batteryId: string, quantity: number): Quote => {
      const quote = runPrepareQuote(batteryId, quantity);
      dispatch({ type: "quote", quote });
      return quote;
    },
    [],
  );

  const clearQuote = useCallback(() => dispatch({ type: "clear-quote" }), []);

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const actions = useMemo<CatalogActions>(
    () => ({
      setQuery,
      search,
      showResults,
      selectBattery,
      prepareQuote,
      clearQuote,
      reset,
    }),
    [clearQuote, prepareQuote, reset, search, selectBattery, setQuery, showResults],
  );

  return (
    <CatalogContext.Provider value={{ state, actions }}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextValue {
  const context = useContext(CatalogContext);
  if (!context) {
    throw new Error("useCatalog debe usarse dentro de CatalogProvider.");
  }
  return context;
}
