"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  catalogReducer,
  createInitialCatalogState,
  runPrepareBatteryQuote,
  runPrepareQuote,
  runSelectBattery,
  runSelectTire,
  type CatalogAction,
} from "@/features/catalog/catalog-state";
import { requireBatteryLocation } from "@/lib/battery-catalog";
import {
  requireBatterySearchInputs,
  requireDiscoveryInputs,
  requireStockInputs,
  requireTireSearchInputs,
} from "@/lib/catalog-provenance";
import type {
  Battery,
  BatteryCatalogListing,
  BatterySearchCriteria,
  BatterySearchResult,
  CatalogActions,
  CatalogDiscoveryCriteria,
  CatalogDiscoveryResult,
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
  getSession(): Promise<string>;
  getState(): CatalogState;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function formatCatalogOptions(options: unknown): string {
  if (!Array.isArray(options) || !options.length) return "";
  return ` Opciones:
${options
    .map((option, index) => `${index + 1}. ${String(option)}`)
    .join("\n")}`;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal, sessionId?: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sessionId ? { "x-catalog-session": sessionId } : {}) },
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
  const sessionRef = useRef<Promise<string> | null>(null);
  const commit = useCallback((action: CatalogAction) => {
    // Tools can run consecutively before React commits the visible update.
    stateRef.current = catalogReducer(stateRef.current, action);
    dispatch(action);
  }, []);
  const getState = useCallback(() => stateRef.current, []);

  const getSession = useCallback((): Promise<string> => {
    sessionRef.current ??= postJson<{ sessionId: string }>("/api/catalog/session", {})
      .then(({ sessionId }) => sessionId);
    return sessionRef.current;
  }, []);

  const setQuery = useCallback((query: string) => commit({ type: "set-query", query }), [commit]);

  const discover = useCallback(async (
    criteria: CatalogDiscoveryCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<CatalogDiscoveryResult> => {
    requireDiscoveryInputs(stateRef.current.discoveries, criteria);
    if (criteria.productId) {
      if (criteria.productType === "battery") runSelectBattery(stateRef.current.batteries, criteria.productId);
      else runSelectTire(stateRef.current.tires, criteria.productId);
    }
    const result = await postJson<CatalogDiscoveryResult>(
      "/api/catalog/discovery",
      criteria,
      execution?.signal,
      await getSession(),
    );
    assertCurrent(execution);
    commit({ type: "discovered", result });
    return result;
  }, [commit, getSession]);

  const search = useCallback(async (
    criteria: TireSearchCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<TireSearchResult> => {
    requireTireSearchInputs(stateRef.current.discoveries, criteria);
    assertCurrent(execution);
    commit({ type: "search-started", productType: "tire" });
    const result = await postJson<TireSearchResult>(
      "/api/catalog/search",
      criteria,
      execution?.signal,
      await getSession(),
    );
    assertCurrent(execution);
    commit({ type: "searched", criteria, result });
    return result;
  }, [commit, getSession]);

  const searchBatteries = useCallback(async (
    criteria: BatterySearchCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<BatterySearchResult> => {
    requireBatterySearchInputs(stateRef.current.discoveries, criteria);
    assertCurrent(execution);
    commit({ type: "search-started", productType: "battery" });
    const result = await postJson<BatterySearchResult>(
      "/api/catalog/batteries/search",
      criteria,
      execution?.signal,
      await getSession(),
    );
    assertCurrent(execution);
    commit({ type: "batteries-searched", criteria, result });
    return result;
  }, [commit, getSession]);

  const readBatteryCatalog = useCallback(async (execution?: CatalogExecutionContext): Promise<BatteryCatalogListing> => {
    assertCurrent(execution);
    commit({ type: "search-started", productType: "battery" });
    const listing = await postJson<BatteryCatalogListing>("/api/catalog/batteries/products", {},
      execution?.signal, await getSession());
    assertCurrent(execution);
    commit({ type: "battery-catalog-read", listing });
    return listing;
  }, [commit, getSession]);

  const presentBatteryAlternatives = useCallback(async (
    listingId: string, batteryIds: string[], execution?: CatalogExecutionContext,
  ): Promise<BatterySearchResult> => {
    const listing = stateRef.current.batteryListing;
    if (!listing || listing.listingId !== listingId ||
        batteryIds.some((id) => !listing.products.some((product) => product.id === id))) {
      throw new Error("Los IDs no pertenecen a la consulta vigente de baterías.");
    }
    const result = await postJson<BatterySearchResult>("/api/catalog/batteries/alternatives",
      { listingId, batteryIds }, execution?.signal, await getSession());
    assertCurrent(execution);
    commit({ type: "battery-alternatives", result });
    return result;
  }, [commit, getSession]);

  const summarizeStock = useCallback(async (input: {
    category: "01" | "02" | "03" | "04";
    cityId?: string;
    warehouseId?: string;
  }, execution?: CatalogExecutionContext): Promise<TireStockSummary> => {
    requireStockInputs(stateRef.current.discoveries, input);
    const summary = await postJson<TireStockSummary>(
      "/api/catalog/stock",
      input,
      execution?.signal,
      await getSession(),
    );
    assertCurrent(execution);
    commit({ type: "stock-summary", summary });
    return summary;
  }, [commit, getSession]);

  const selectTire = useCallback((
    tireId: string,
    execution?: CatalogExecutionContext,
  ): Tire => {
    assertCurrent(execution);
    const tire = runSelectTire(stateRef.current.tires, tireId);
    commit({ type: "select", tireId });
    return tire;
  }, [commit]);

  const selectBattery = useCallback((
    batteryId: string,
    locationId?: string,
    execution?: CatalogExecutionContext,
  ): Battery => {
    assertCurrent(execution);
    const battery = runSelectBattery(stateRef.current.batteries, batteryId);
    const selectedLocationId = locationId
      ? requireBatteryLocation(battery, locationId).id
      : null;
    commit({ type: "select-battery", batteryId, locationId: selectedLocationId });
    return battery;
  }, [commit]);

  const prepareQuote = useCallback((
    tireId: string,
    quantity: number,
    quantityMode: QuoteQuantityMode = "total",
    warehouseId?: string,
    execution?: CatalogExecutionContext,
  ) => {
    assertCurrent(execution);
    const quote = runPrepareQuote(
      stateRef.current.tires,
      tireId,
      quantity,
      quantityMode,
      warehouseId,
      stateRef.current.quote,
    );
    commit({ type: "quote", quote });
    return quote;
  }, [commit]);

  const prepareBatteryQuote = useCallback((
    batteryId: string,
    quantity: number,
    locationId: string,
    execution?: CatalogExecutionContext,
  ) => {
    assertCurrent(execution);
    const quote = runPrepareBatteryQuote(
      stateRef.current.batteries,
      batteryId,
      quantity,
      locationId,
    );
    commit({ type: "battery-quote", quote });
    return quote;
  }, [commit]);

  const clearQuote = useCallback(() => commit({ type: "clear-quote" }), [commit]);
  const reset = useCallback(() => {
    sessionRef.current = null;
    commit({ type: "reset" });
  }, [commit]);

  const actions = useMemo<CatalogActions>(() => ({
    setQuery,
    discover,
    search,
    searchBatteries,
    readBatteryCatalog,
    presentBatteryAlternatives,
    summarizeStock,
    selectTire,
    selectBattery,
    prepareQuote,
    prepareBatteryQuote,
    clearQuote,
    reset,
  }), [
    clearQuote,
    discover,
    prepareBatteryQuote,
    prepareQuote,
    reset,
    search,
    searchBatteries,
    readBatteryCatalog,
    presentBatteryAlternatives,
    selectBattery,
    selectTire,
    setQuery,
    summarizeStock,
  ]);

  return <CatalogContext.Provider value={{ state, actions, getSession, getState }}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog debe usarse dentro de CatalogProvider.");
  return context;
}
