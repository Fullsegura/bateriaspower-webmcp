import {
  discoverBatteryApplications,
  discoverBatteryBrands,
  discoverBatteryLocations,
  discoverBatteryMakes,
  discoverBatteryYears,
} from "@/lib/battery-catalog";
import {
  discoverTireApplications,
  discoverTireBrands,
  discoverTireLocations,
  discoverTireMakes,
  discoverTireYears,
} from "@/lib/powerllanta";
import type {
  CatalogDiscoveryCriteria,
  CatalogDiscoveryResult,
} from "@/types/catalog";

function requireMake(criteria: CatalogDiscoveryCriteria): string {
  if (!criteria.makeId) throw new Error("makeId es obligatorio para descubrir aplicaciones.");
  return criteria.makeId;
}

export async function discoverCatalog(
  criteria: CatalogDiscoveryCriteria,
): Promise<CatalogDiscoveryResult> {
  let options;
  if (criteria.productType === "battery") {
    if (criteria.scope === "vehicle_makes") options = discoverBatteryMakes();
    else if (criteria.scope === "vehicle_years") options = discoverBatteryYears(requireMake(criteria));
    else if (criteria.scope === "vehicle_applications") {
      options = discoverBatteryApplications(requireMake(criteria), criteria.year);
    } else if (criteria.scope === "product_brands") options = discoverBatteryBrands();
    else options = discoverBatteryLocations(criteria.productId, criteria.cityId);
  } else {
    if (criteria.scope === "vehicle_makes") options = await discoverTireMakes();
    else if (criteria.scope === "vehicle_years") options = await discoverTireYears(requireMake(criteria));
    else if (criteria.scope === "vehicle_applications") {
      options = await discoverTireApplications(requireMake(criteria), criteria.year);
    } else {
      if (!criteria.category) {
        throw new Error("category es obligatorio para descubrir marcas o localidades de llantas.");
      }
      options = criteria.scope === "product_brands"
        ? await discoverTireBrands(criteria.category)
        : await discoverTireLocations(criteria.category, criteria.productId, criteria.cityId);
    }
  }

  return {
    productType: criteria.productType,
    scope: criteria.scope,
    context: {
      makeId: criteria.makeId,
      year: criteria.year,
      category: criteria.category,
      productId: criteria.productId,
      cityId: criteria.cityId,
    },
    options,
    queriedAt: new Date().toISOString(),
  };
}
