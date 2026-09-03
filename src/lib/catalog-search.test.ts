import { describe, expect, it } from "vitest";

import {
  batteries,
  catalogMetadata,
  compatibility,
  createQuote,
  getBatteriesByIds,
  searchVehicleBatteries,
} from "@/lib/catalog-search";

describe("catálogo Baterías Ecuador", () => {
  it("importa los volúmenes verificados de la fuente", () => {
    expect(catalogMetadata.catalogEntries).toBe(2026);
    expect(batteries).toHaveLength(32);
    expect(compatibility).toHaveLength(1307);
    expect(catalogMetadata.vehicleMakes).toBe(118);
    expect(catalogMetadata.vehicleModels).toBe(1112);
  });

  it("mantiene precios y referencias válidas", () => {
    const ids = new Set(batteries.map(({ id }) => id));
    expect(batteries.every(({ price }) => price > 0)).toBe(true);
    expect(
      compatibility.every(({ batteryIds }) =>
        batteryIds.every((batteryId) => ids.has(batteryId)),
      ),
    ).toBe(true);
  });

  it("encuentra las opciones de Toyota Corolla 2018 1.8", () => {
    const results = searchVehicleBatteries({
      make: "Toyota",
      model: "Corolla",
      year: 2018,
      engine: "1.8",
    });
    expect(results.map(({ id }) => id)).toEqual([
      "be-n40-full-equipo",
      "be-n40-high-power",
      "be-55-full-equipo",
      "be-55-high-power",
      "be-65-high-power",
    ]);
  });

  it("acepta acabados dentro del modelo Ford F-150", () => {
    const results = searchVehicleBatteries({
      make: "Ford",
      model: "F-150 XLT 4x2",
      year: 2014,
    });
    expect(results.map(({ id }) => id)).toEqual(["be-48-high-power"]);
  });

  it("rechaza IDs y cantidades inválidas", () => {
    expect(() => getBatteriesByIds(["inexistente"])).toThrow();
    expect(() => createQuote("be-48-high-power", 0)).toThrow();
  });

  it("calcula una cotización con el precio exacto de la fuente", () => {
    expect(createQuote("be-48-high-power", 2)).toEqual({
      batteryId: "be-48-high-power",
      quantity: 2,
      unitPrice: 199.53,
      total: 399.06,
    });
  });
});
