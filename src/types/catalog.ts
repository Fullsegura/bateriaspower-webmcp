export type TireCategory = "01" | "02" | "03" | "04";
export type ProductKind = "tire" | "battery";
export type CatalogDiscoveryScope =
  | "vehicle_makes"
  | "vehicle_years"
  | "vehicle_applications"
  | "product_brands"
  | "locations";

export interface CatalogDiscoveryOption {
  id: string;
  label: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CatalogDiscoveryContext {
  makeId?: string;
  year?: number;
  category?: TireCategory;
  productId?: string;
  cityId?: string;
}

export interface CatalogDiscoveryCriteria extends CatalogDiscoveryContext {
  productType: ProductKind;
  scope: CatalogDiscoveryScope;
}

export interface CatalogDiscoveryResult {
  productType: ProductKind;
  scope: CatalogDiscoveryScope;
  context: CatalogDiscoveryContext;
  options: CatalogDiscoveryOption[];
  queriedAt: string;
}

export type BatteryFamily =
  | "Full Equipo"
  | "High Power"
  | "Mega Power"
  | "Heavy Duty";

export interface BatteryLocationStock {
  id: string;
  cityId?: string;
  location: string;
  inventory: number;
  fulfillment?: "pickup" | "delivery";
}

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
  locations: BatteryLocationStock[];
}

export interface BatteryCompatibility {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  engine: string;
  batteryIds: string[];
  sourceType: string;
}

export interface BatterySearchCriteria {
  applicationId: string;
  year: number;
}

export interface ResolvedBatteryVehicle {
  make: string;
  model: string;
  year: number;
  engine: string | null;
}

export interface BatterySearchResult {
  batteries: Battery[];
  queriedAt: string;
  source: string;
  note: string;
  resolvedVehicle: ResolvedBatteryVehicle | null;
}

export interface BatteryCatalogListing {
  listingId: string;
  products: Array<Pick<Battery, "id" | "name" | "capacityAh" | "cca" | "polarity" | "dimensions" | "reserveCapacityMinutes" | "price">>;
  unknownFields: string[];
  queriedAt: string;
}

export interface BatteryQuote {
  batteryId: string;
  quantity: number;
  location: BatteryLocationStock;
  availableUnits: number;
  unitPrice: number;
  total: number;
}

export interface TireWarehouseStock {
  cityId: string;
  warehouseId: string;
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
  brandId: string;
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
}

export interface VehicleSearchCriteria {
  mode: "vehicle";
  applicationId: string;
  category?: Exclude<TireCategory, "04">;
  productBrandId?: string;
  cityId?: string;
  quantity?: number;
  budget?: number;
}

export interface MeasureSearchCriteria {
  mode: "measure";
  width?: string;
  height?: string;
  rim?: string;
  category?: TireCategory;
  productBrandId?: string;
  cityId?: string;
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
  cityId: string;
  warehouseId: string;
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
  activeProductType: ProductKind | null;
  criteria: TireSearchCriteria | null;
  tires: Tire[];
  selectedTireId: string | null;
  quote: Quote | null;
  stockSummary: TireStockSummary | null;
  resolvedVehicle: ResolvedVehicle | null;
  batteryCriteria: ResolvedBatteryVehicle | null;
  batteryListing: BatteryCatalogListing | null;
  batteries: Battery[];
  selectedBatteryId: string | null;
  selectedBatteryLocationId: string | null;
  batteryQuote: BatteryQuote | null;
  discoveries: CatalogDiscoveryResult[];
  queriedAt: string | null;
  checkout?: import("@/types/payment").CheckoutContext;
}

export interface CatalogExecutionContext {
  signal: AbortSignal;
  isCurrent(): boolean;
}

export interface CatalogActions {
  setQuery(query: string): void;
  discover(
    criteria: CatalogDiscoveryCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<CatalogDiscoveryResult>;
  search(
    criteria: TireSearchCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<TireSearchResult>;
  searchBatteries(
    criteria: BatterySearchCriteria,
    execution?: CatalogExecutionContext,
  ): Promise<BatterySearchResult>;
  readBatteryCatalog(execution?: CatalogExecutionContext): Promise<BatteryCatalogListing>;
  presentBatteryAlternatives(
    listingId: string, batteryIds: string[], execution?: CatalogExecutionContext,
  ): Promise<BatterySearchResult>;
  summarizeStock(input: {
    category: TireCategory;
    cityId?: string;
    warehouseId?: string;
  }, execution?: CatalogExecutionContext): Promise<TireStockSummary>;
  selectTire(tireId: string, execution?: CatalogExecutionContext): Tire;
  selectBattery(
    batteryId: string,
    locationId?: string,
    execution?: CatalogExecutionContext,
  ): Battery;
  prepareQuote(
    tireId: string,
    quantity: number,
    quantityMode?: QuoteQuantityMode,
    warehouseId?: string,
    execution?: CatalogExecutionContext,
  ): Quote;
  prepareBatteryQuote(
    batteryId: string,
    quantity: number,
    locationId: string,
    execution?: CatalogExecutionContext,
  ): BatteryQuote;
  clearQuote(): void;
  reset(): void;
}
