import batteriesData from "@/data/batteries.json";
import compatibilityData from "@/data/compatibility.json";
import locationData from "@/data/battery-locations.json";
import type {
  Battery,
  BatteryCompatibility,
  BatteryLocationStock,
  BatteryQuote,
  CatalogDiscoveryOption,
  BatterySearchCriteria,
  BatterySearchResult,
} from "@/types/catalog";

interface BatteryData extends Omit<Battery, "locations"> {
  localidad: string[];
  inventario: number[];
}

function mapBattery(entry: BatteryData): Battery {
  if (entry.localidad.length !== entry.inventario.length) {
    throw new Error(`El inventario de ${entry.id} no coincide con sus localidades.`);
  }
  const { localidad, inventario, ...battery } = entry;
  return {
    ...battery,
    locations: localidad.map((location, index): BatteryLocationStock => {
      const metadata = locationData.find((entry) => entry.location === location);
      if (!metadata || (metadata.fulfillment !== "pickup" && metadata.fulfillment !== "delivery")) {
        throw new Error(`La localidad de ${entry.id} necesita una modalidad de entrega válida.`);
      }
      return {
        id: `battery-location:${encodeURIComponent(location)}`,
        cityId: metadata.cityId ?? undefined,
        fulfillment: metadata.fulfillment,
        location,
        inventory: inventario[index],
      };
    }),
  };
}

const batteries = (batteriesData as BatteryData[]).map(mapBattery);
const compatibility = compatibilityData as BatteryCompatibility[];
const batteryById = new Map(batteries.map((battery) => [battery.id, battery]));
const uniqueMakes = [...new Set(compatibility.map((entry) => entry.make))];

function batteryMakeId(make: string): string {
  return `battery-make:${encodeURIComponent(make)}`;
}

function batteryApplicationId(entry: BatteryCompatibility): string {
  return [
    "battery-application",
    entry.make,
    entry.model,
    entry.yearFrom,
    entry.yearTo,
    entry.engine,
    [...entry.batteryIds].sort().join(","),
  ].map((part) => encodeURIComponent(String(part))).join(":");
}

const compatibilityById = new Map(
  compatibility.map((entry) => [batteryApplicationId(entry), entry]),
);

export class BatteryCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export function getCatalogPreviewBattery(): Battery | null {
  return batteries[0] ?? null;
}

export function getBatteryCatalogProducts(): Battery[] {
  return batteries;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function discoverBatteryMakes(): CatalogDiscoveryOption[] {
  return uniqueMakes.map((make) => ({ id: batteryMakeId(make), label: make }));
}

export function discoverBatteryApplications(
  makeId: string,
  year?: number,
): CatalogDiscoveryOption[] {
  const make = uniqueMakes.find((entry) => batteryMakeId(entry) === makeId);
  if (!make) throw new BatteryCatalogError("makeId no pertenece al catálogo de baterías.", 422);
  return compatibility
    .filter((entry) => entry.make === make && (year === undefined ||
      (year >= entry.yearFrom && year <= entry.yearTo)))
    .map((entry) => ({
      id: batteryApplicationId(entry),
      label: [entry.model, entry.engine].filter(Boolean).join(" · "),
      metadata: {
        make: entry.make,
        model: entry.model,
        yearFrom: entry.yearFrom,
        yearTo: entry.yearTo,
        engine: entry.engine || null,
      },
    }));
}

export function discoverBatteryYears(makeId: string): CatalogDiscoveryOption[] {
  const applications = discoverBatteryApplications(makeId);
  const years = new Set<number>();
  for (const option of applications) {
    const from = Number(option.metadata?.yearFrom);
    const to = Number(option.metadata?.yearTo);
    for (let year = from; year <= to; year += 1) years.add(year);
  }
  return [...years].sort((a, b) => a - b).map((year) => ({
    id: `battery-year:${year}`,
    label: String(year),
    metadata: { year },
  }));
}

export function discoverBatteryBrands(): CatalogDiscoveryOption[] {
  return unique(batteries.map((battery) => battery.family)).map((family) => ({
    id: `battery-brand:${encodeURIComponent(family)}`,
    label: family,
  }));
}

export function discoverBatteryLocations(productId?: string, cityId?: string): CatalogDiscoveryOption[] {
  const byId = new Map<string, CatalogDiscoveryOption>();
  const products = productId ? [requireBattery(batteries, productId)] : batteries;
  for (const battery of products) {
    for (const location of battery.locations) {
      if (!cityId || location.cityId === cityId) {
        byId.set(location.id, {
          id: location.id,
          label: location.location,
          metadata: {
            type: "location",
            cityId: location.cityId ?? null,
            ...(productId ? { inventory: location.inventory } : {}),
          },
        });
      }
      if (!cityId && location.cityId) {
        const city = locationData.find((entry) => entry.cityId === location.cityId);
        if (city?.city) byId.set(location.cityId, {
          id: location.cityId,
          label: city.city,
          metadata: { type: "city" },
        });
      }
    }
  }
  return [...byId.values()];
}

export function requireBattery(items: Battery[], batteryId: string): Battery {
  const battery = items.find((item) => item.id === batteryId);
  if (!battery) throw new Error(`La batería ${batteryId} no existe en los resultados actuales.`);
  return battery;
}

export function requireBatteryLocation(
  battery: Battery,
  locationId: string,
): BatteryLocationStock {
  const location = battery.locations.find((entry) => entry.id === locationId);
  if (!location) {
    throw new Error(
      `La localidad no existe para esta batería. Opciones: ${battery.locations.map((entry) => entry.location).join(", ")}.`,
    );
  }
  return location;
}

export function createBatteryQuote(
  items: Battery[],
  batteryId: string,
  quantity: number,
  locationId: string,
): BatteryQuote {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("La cantidad debe ser un entero entre 1 y 20.");
  }
  const battery = requireBattery(items, batteryId);
  const location = requireBatteryLocation(battery, locationId);
  if (location.inventory < quantity) {
    throw new Error(
      `${location.location} reporta ${location.inventory} unidades; no alcanza para ${quantity}.`,
    );
  }
  return {
    batteryId,
    quantity,
    location,
    availableUnits: location.inventory,
    unitPrice: battery.price,
    total: Number((battery.price * quantity).toFixed(2)),
  };
}

export async function searchVehicleBatteries(
  criteria: BatterySearchCriteria,
): Promise<BatterySearchResult> {
  const application = compatibilityById.get(criteria.applicationId);
  if (!application) {
    throw new BatteryCatalogError(
      "applicationId no pertenece al catálogo de baterías.",
      422,
    );
  }
  if (criteria.year < application.yearFrom || criteria.year > application.yearTo) {
    throw new BatteryCatalogError(
      "applicationId no corresponde al año indicado.",
      422,
      [`${application.yearFrom}-${application.yearTo}`],
    );
  }

  const batteryIds = unique(application.batteryIds);
  const results = batteryIds
    .map((id) => batteryById.get(id))
    .filter((battery): battery is Battery => Boolean(battery))
    .slice(0, 5);
  if (!results.length) {
    throw new BatteryCatalogError("No hay baterías publicadas para esta aplicación.", 404);
  }

  return {
    batteries: results,
    queriedAt: new Date().toISOString(),
    source: "Catálogo PowerAuto",
    note: "Inventario por localidad.",
    resolvedVehicle: {
      make: application.make,
      model: application.model,
      year: criteria.year,
      engine: application.engine || null,
    },
  };
}
