export type BatteryFamily =
  | "Full Equipo"
  | "High Power"
  | "Mega Power"
  | "Heavy Duty";

export interface Battery {
  id: string;
  code: string;
  family: BatteryFamily;
  name: string;
  description: string;
  capacityAh: number;
  cca: number;
  polarity: string;
  dimensions: string;
  reserveCapacityMinutes: number;
  price: number;
  image: string | null;
}

export interface Compatibility {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  engine: string;
  batteryIds: string[];
  sourceType: string;
}

export interface VehicleCriteria {
  make: string;
  model: string;
  year: number;
  engine?: string;
}

export interface Quote {
  batteryId: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface CatalogState {
  query: string;
  criteria: VehicleCriteria | null;
  resultIds: string[];
  selectedBatteryId: string | null;
  quote: Quote | null;
}

export interface CatalogActions {
  setQuery(query: string): void;
  search(criteria: VehicleCriteria): Battery[];
  showResults(batteryIds: string[]): Battery[];
  selectBattery(batteryId: string): Battery;
  prepareQuote(batteryId: string, quantity: number): Quote;
  clearQuote(): void;
  reset(): void;
}
