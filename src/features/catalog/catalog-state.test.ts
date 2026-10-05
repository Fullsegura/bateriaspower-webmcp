import { describe, expect, it } from "vitest";

import {
  catalogReducer,
  createInitialCatalogState,
  runPrepareQuote,
} from "@/features/catalog/catalog-state";
import type { BatteryQuote, BatterySearchResult, CatalogState, Quote, Tire } from "@/types/catalog";

describe("estado inicial del catálogo", () => {
  it.each(["tire", "battery"] as const)("invalida resultados y cotizaciones antes de buscar %s, incluso si la consulta falla", (productType) => {
    const previous: CatalogState = {
      ...createInitialCatalogState("consulta actual"),
      selectedTireId: "old-tire",
      selectedBatteryId: "old-battery",
      selectedBatteryLocationId: "old-location",
      tires: [{ id: "old-tire" } as Tire],
      quote: { tireId: "old-tire" } as Quote,
      batteryQuote: { batteryId: "old-battery" } as BatteryQuote,
      discoveries: [{ productType, scope: "vehicle_makes", context: {}, options: [], queriedAt: "now" }],
    };
    const next = catalogReducer(previous, { type: "search-started", productType });
    expect(next).toEqual({
      ...createInitialCatalogState(previous.query),
      activeProductType: productType,
      discoveries: previous.discoveries,
    });
  });

  it("reset elimina todas las selecciones y cotizaciones sin heredar IDs de otro contexto", () => {
    const previous = {
      ...createInitialCatalogState(),
      selectedTireId: "tire",
      selectedBatteryId: "battery",
      quote: { tireId: "tire" } as Quote,
      batteryQuote: { batteryId: "battery" } as BatteryQuote,
    };
    expect(catalogReducer(previous, { type: "reset" })).toEqual(createInitialCatalogState(""));
  });
  it("conserva la consulta recibida desde Fullsegura", () => {
    expect(createInitialCatalogState("Isuzu D-Max 2022 en Quito").query)
      .toBe("Isuzu D-Max 2022 en Quito");
  });

  it("mantiene la consulta predeterminada fuera del modo embebido", () => {
    expect(createInitialCatalogState().query).toBe("Toyota RAV4 2018 en Quito");
  });

  it("conserva en pantalla la marca resuelta por el catálogo", () => {
    const result = {
      batteries: [],
      queriedAt: "2026-10-04T11:00:00.000Z",
      source: "Catálogo PowerAuto",
      note: "",
      resolvedVehicle: {
        make: "CHEVROLET",
        model: "SAIL",
        year: 2020,
        engine: "1.4",
      },
    } satisfies BatterySearchResult;

    const state = catalogReducer(createInitialCatalogState(), {
      type: "batteries-searched",
      criteria: { applicationId: "battery-application:sail", year: 2020 },
      result,
    });

    expect(state.batteryCriteria).toEqual({
      make: "CHEVROLET",
      model: "SAIL",
      year: 2020,
      engine: "1.4",
    });
  });

  it("conserva la localidad indicada al seleccionar una batería", () => {
    const state = catalogReducer(createInitialCatalogState(), {
      type: "select-battery",
      batteryId: "battery-1",
      locationId: "battery-location:Santo%20Domingo",
    });

    expect(state.selectedBatteryLocationId).toBe("battery-location:Santo%20Domingo");
  });

  it("suma unidades adicionales y conserva el local cotizado", () => {
    const tire = {
      id: "sku-1",
      price: {
        status: "available",
        unitWithoutVat: 100,
        ecoValue: 1,
        vatPercent: 15,
        unitKnownChargesTotal: 116.15,
      },
      warehouses: [{
        cityId: "CUE",
        warehouseId: "CUE:01",
        cityCode: "CUE",
        warehouseCode: "01",
        warehouseName: "GIL RAMIREZ",
        quantity: 8,
      }],
    } as Tire;
    const currentQuote = {
      tireId: "sku-1",
      quantity: 1,
      warehouse: tire.warehouses[0],
    } as Quote;

    const quote = runPrepareQuote(
      [tire],
      tire.id,
      2,
      "additional",
      undefined,
      currentQuote,
    );

    expect(quote.quantity).toBe(3);
    expect(quote.warehouse).toEqual(tire.warehouses[0]);
  });

  it("conserva el local al cambiar la cantidad total", () => {
    const tire = {
      id: "sku-1",
      price: {
        status: "available",
        unitWithoutVat: 100,
        ecoValue: 1,
        vatPercent: 15,
        unitKnownChargesTotal: 116.15,
      },
      warehouses: [{
        cityId: "CUE",
        warehouseId: "CUE:01",
        cityCode: "CUE",
        warehouseCode: "01",
        warehouseName: "GIL RAMIREZ",
        quantity: 8,
      }],
    } as Tire;
    const currentQuote = {
      tireId: "sku-1",
      quantity: 1,
      warehouse: tire.warehouses[0],
    } as Quote;

    const quote = runPrepareQuote(
      [tire],
      tire.id,
      4,
      "total",
      undefined,
      currentQuote,
    );

    expect(quote.quantity).toBe(4);
    expect(quote.warehouse).toEqual(tire.warehouses[0]);
  });

  it("rechaza sumar unidades cuando no existe una cotización previa", () => {
    expect(() => runPrepareQuote(
      [{ id: "sku-1" } as Tire],
      "sku-1",
      2,
      "additional",
    )).toThrow("No existe una cotización");
  });
});
