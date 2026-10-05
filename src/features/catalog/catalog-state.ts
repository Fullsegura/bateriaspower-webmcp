import { createQuote, requireTire } from "@/lib/catalog-search";
import { createBatteryQuote, requireBattery } from "@/lib/battery-catalog";
import { upsertDiscovery } from "@/lib/catalog-provenance";
import type {
  Battery,
  BatteryQuote,
  BatteryCatalogListing,
  BatterySearchCriteria,
  BatterySearchResult,
  CatalogState,
  CatalogDiscoveryResult,
  Quote,
  QuoteQuantityMode,
  Tire,
  TireSearchCriteria,
  TireSearchResult,
  TireStockSummary,
} from "@/types/catalog";

export type CatalogAction =
  | { type: "set-query"; query: string }
  | { type: "discovered"; result: CatalogDiscoveryResult }
  | { type: "search-started"; productType: "tire" | "battery" }
  | { type: "searched"; criteria: TireSearchCriteria; result: TireSearchResult }
  | { type: "batteries-searched"; criteria: BatterySearchCriteria; result: BatterySearchResult }
  | { type: "battery-catalog-read"; listing: BatteryCatalogListing }
  | { type: "battery-alternatives"; result: BatterySearchResult }
  | { type: "stock-summary"; summary: TireStockSummary }
  | { type: "select"; tireId: string }
  | { type: "quote"; quote: Quote }
  | { type: "select-battery"; batteryId: string; locationId: string | null }
  | { type: "battery-quote"; quote: BatteryQuote }
  | { type: "clear-quote" }
  | { type: "reset" };

export function createInitialCatalogState(
  query = "Toyota RAV4 2018 en Quito",
): CatalogState {
  return {
    query,
    activeProductType: null,
    criteria: null,
    tires: [],
    selectedTireId: null,
    quote: null,
    stockSummary: null,
    resolvedVehicle: null,
    batteryCriteria: null,
    batteryListing: null,
    batteries: [],
    selectedBatteryId: null,
    selectedBatteryLocationId: null,
    batteryQuote: null,
    discoveries: [],
    queriedAt: null,
  };
}

export function catalogReducer(state: CatalogState, action: CatalogAction): CatalogState {
  switch (action.type) {
    case "set-query":
      return { ...state, query: action.query };
    case "discovered":
      return {
        ...state,
        discoveries: upsertDiscovery(state.discoveries, action.result),
      };
    case "search-started":
      return {
        ...createInitialCatalogState(state.query),
        activeProductType: action.productType,
        discoveries: state.discoveries,
      };
    case "searched":
      return {
        ...state,
        activeProductType: "tire",
        criteria: action.criteria,
        tires: action.result.tires,
        selectedTireId: null,
        quote: null,
        stockSummary: null,
        resolvedVehicle: action.result.resolvedVehicle ?? null,
        batteryCriteria: null,
        batteryListing: null,
        batteries: [],
        selectedBatteryId: null,
        selectedBatteryLocationId: null,
        batteryQuote: null,
        queriedAt: action.result.queriedAt,
      };
    case "batteries-searched":
      return {
        ...state,
        activeProductType: "battery",
        criteria: null,
        tires: [],
        selectedTireId: null,
        quote: null,
        stockSummary: null,
        resolvedVehicle: null,
        batteryCriteria: action.result.resolvedVehicle,
        batteryListing: null,
        batteries: action.result.batteries,
        selectedBatteryId: null,
        selectedBatteryLocationId: null,
        batteryQuote: null,
        queriedAt: action.result.queriedAt,
      };
    case "battery-catalog-read":
      return { ...createInitialCatalogState(state.query), activeProductType: "battery", batteryListing: action.listing };
    case "battery-alternatives":
      return { ...createInitialCatalogState(state.query), activeProductType: "battery",
        batteryListing: state.batteryListing, batteries: action.result.batteries,
        queriedAt: action.result.queriedAt };
    case "stock-summary":
      return { ...state, stockSummary: action.summary, queriedAt: action.summary.queriedAt };
    case "select":
      return { ...state, selectedTireId: action.tireId, quote: null };
    case "quote":
      return { ...state, selectedTireId: action.quote.tireId, quote: action.quote };
    case "select-battery":
      return {
        ...state,
        selectedBatteryId: action.batteryId,
        selectedBatteryLocationId: action.locationId,
        batteryQuote: null,
      };
    case "battery-quote":
      return {
        ...state,
        selectedBatteryId: action.quote.batteryId,
        selectedBatteryLocationId: action.quote.location.id,
        batteryQuote: action.quote,
      };
    case "clear-quote":
      return { ...state, quote: null, batteryQuote: null };
    case "reset":
      return { ...createInitialCatalogState(), query: "" };
  }
}

export function runSelectBattery(batteries: Battery[], batteryId: string): Battery {
  return requireBattery(batteries, batteryId);
}

export function runPrepareBatteryQuote(
  batteries: Battery[],
  batteryId: string,
  quantity: number,
  locationId: string,
): BatteryQuote {
  return createBatteryQuote(batteries, batteryId, quantity, locationId);
}

export function runSelectTire(tires: Tire[], tireId: string): Tire {
  return requireTire(tires, tireId);
}

export function runPrepareQuote(
  tires: Tire[],
  tireId: string,
  quantity: number,
  quantityMode: QuoteQuantityMode = "total",
  warehouseId?: string,
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
      warehouseId ?? currentQuote.warehouse?.warehouseId,
    );
  }
  const preservedWarehouse =
    !warehouseId && currentQuote?.tireId === tireId
      ? currentQuote.warehouse?.warehouseId
      : undefined;
  return createQuote(tires, tireId, quantity, warehouseId ?? preservedWarehouse);
}
