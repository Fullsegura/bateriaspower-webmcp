import {
  createQuote,
  getBatteriesByIds,
  requireBattery,
  searchVehicleBatteries,
} from "@/lib/catalog-search";
import type {
  Battery,
  CatalogState,
  Quote,
  VehicleCriteria,
} from "@/types/catalog";

export type CatalogAction =
  | { type: "set-query"; query: string }
  | { type: "searched"; criteria: VehicleCriteria; resultIds: string[] }
  | { type: "show-results"; resultIds: string[] }
  | { type: "select"; batteryId: string }
  | { type: "quote"; quote: Quote }
  | { type: "clear-quote" }
  | { type: "reset" };

const demoCriteria: VehicleCriteria = {
  make: "Toyota",
  model: "Corolla",
  year: 2018,
  engine: "1.8",
};

export function createInitialCatalogState(): CatalogState {
  const results = searchVehicleBatteries(demoCriteria);
  const selectedBatteryId = results[0]?.id ?? null;

  return {
    query: "Toyota Corolla 2018 motor 1.8",
    criteria: demoCriteria,
    resultIds: results.map((battery) => battery.id),
    selectedBatteryId,
    quote: null,
  };
}

export function catalogReducer(
  state: CatalogState,
  action: CatalogAction,
): CatalogState {
  switch (action.type) {
    case "set-query":
      return { ...state, query: action.query };
    case "searched":
      return {
        ...state,
        criteria: action.criteria,
        resultIds: action.resultIds,
        selectedBatteryId: null,
        quote: null,
      };
    case "show-results":
      return {
        ...state,
        resultIds: action.resultIds,
        selectedBatteryId: action.resultIds.includes(state.selectedBatteryId ?? "")
          ? state.selectedBatteryId
          : null,
        quote: action.resultIds.includes(state.quote?.batteryId ?? "")
          ? state.quote
          : null,
      };
    case "select":
      return { ...state, selectedBatteryId: action.batteryId, quote: null };
    case "quote":
      return {
        ...state,
        selectedBatteryId: action.quote.batteryId,
        quote: action.quote,
      };
    case "clear-quote":
      return { ...state, quote: null };
    case "reset":
      return {
        query: "",
        criteria: null,
        resultIds: [],
        selectedBatteryId: null,
        quote: null,
      };
  }
}

export function runSearch(criteria: VehicleCriteria): Battery[] {
  return searchVehicleBatteries(criteria);
}

export function runShowResults(batteryIds: string[]): Battery[] {
  return getBatteriesByIds(batteryIds);
}

export function runSelectBattery(batteryId: string): Battery {
  return requireBattery(batteryId);
}

export function runPrepareQuote(
  batteryId: string,
  quantity: number,
): Quote {
  return createQuote(batteryId, quantity);
}
