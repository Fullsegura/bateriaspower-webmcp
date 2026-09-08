export type TireCategory = "01" | "02" | "03" | "04";

export interface TireWarehouseStock {
  cityCode: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
}

export interface TirePrice {
  status: "available" | "confirm";
  listWithoutVat: number | null;
  discountPercent: number | null;
  unitWithoutVat: number | null;
  ecoValue: number | null;
  vatPercent: number | null;
  unitKnownChargesTotal: number | null;
}

export interface Tire {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: TireCategory;
  categoryLabel: string;
  width: string;
  height: string;
  rim: string;
  size: string;
  tread: string;
  application: string;
  loadDescription: string;
  speedDescription: string;
  details: string;
  price: TirePrice;
  warehouses: TireWarehouseStock[];
  totalStock: number | null;
  stockDiscrepancy: string | null;
  availability: {
    scope: string;
    requestedQuantity: number;
    availableUnits: number;
    singleWarehouseCanFulfill: boolean;
    requiresMultipleWarehouses: boolean;
  };
  image: string | null;
  secondaryImages: string[];
  sourceUrl: string;
}

export interface VehicleSearchCriteria {
  mode: "vehicle";
  make: string;
  year: number;
  model: string;
  category?: Exclude<TireCategory, "04">;
  brand?: string;
  city?: string;
  quantity?: number;
  budget?: number;
}

export interface MeasureSearchCriteria {
  mode: "measure";
  width?: string;
  height?: string;
  rim?: string;
  category?: TireCategory;
  brand?: string;
  city?: string;
  quantity?: number;
  budget?: number;
}

export type TireSearchCriteria = VehicleSearchCriteria | MeasureSearchCriteria;

export interface ResolvedVehicle {
  make: string;
  year: number;
  model: string;
  sizes: string[];
}

export interface TireSearchResult {
  tires: Tire[];
  queriedAt: string;
  source: string;
  note: string;
  resolvedVehicle?: ResolvedVehicle;
}

export interface TireStockGroup {
  cityCode: string;
  warehouseCode: string;
  warehouseName: string;
  quantity: number;
  productCount: number;
}

export interface TireStockSummary {
  category: TireCategory;
  groups: TireStockGroup[];
  totalUnits: number;
  queriedAt: string;
  source: string;
  note: string;
}

export interface Quote {
  tireId: string;
  quantity: number;
  warehouse: TireWarehouseStock | null;
  availableUnits: number;
  requiresMultipleWarehouses: boolean;
  unitWithoutVat: number | null;
  unitKnownChargesTotal: number | null;
  subtotalWithoutVat: number | null;
  ecoValueTotal: number | null;
  vatPercent: number | null;
  vatTotal: number | null;
  totalKnownCharges: number | null;
  priceStatus: TirePrice["status"];
}

export type QuoteQuantityMode = "total" | "additional";

export interface CatalogState {
  query: string;
  criteria: TireSearchCriteria | null;
  tires: Tire[];
  selectedTireId: string | null;
  quote: Quote | null;
  stockSummary: TireStockSummary | null;
  queriedAt: string | null;
}

export interface CatalogActions {
  setQuery(query: string): void;
  search(criteria: TireSearchCriteria): Promise<TireSearchResult>;
  summarizeStock(input: {
    category: TireCategory;
    city?: string;
    warehouse?: string;
  }): Promise<TireStockSummary>;
  selectTire(tireId: string): Tire;
  prepareQuote(
    tireId: string,
    quantity: number,
    quantityMode?: QuoteQuantityMode,
    warehouse?: string,
  ): Quote;
  clearQuote(): void;
  reset(): void;
}
