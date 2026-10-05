import { describe, expect, it } from "vitest";

import { MAX_CATALOG_ID_LENGTH, parseCatalogDiscoveryCriteria, parseStockCriteria, parseTireSearchCriteria } from "@/lib/catalog-input";
import { parseBatterySearchCriteria } from "@/lib/battery-input";

describe("validación de consultas", () => {
  it("conserva IDs largos y diferencia longitud inválida de un argumento ausente", () => {
    const applicationId = "application:" + "x".repeat(512);
    expect(parseTireSearchCriteria({ mode: "vehicle", applicationId })).toMatchObject({ applicationId });
    expect(parseBatterySearchCriteria({ applicationId, year: 2020 }).applicationId).toBe(applicationId);
    const excessive = "x".repeat(MAX_CATALOG_ID_LENGTH + 1);
    expect(() => parseBatterySearchCriteria({ applicationId: excessive, year: 2020 }))
      .toThrow("longitud permitida");
    expect(() => parseTireSearchCriteria({ mode: "vehicle", applicationId: excessive })).toThrow("no es válido");
    expect(() => parseBatterySearchCriteria({ year: 2020 })).toThrow("es obligatorio");
  });
  it("valida requisitos condicionales de descubrimiento y rechaza filtros no aplicables", () => {
    expect(() => parseCatalogDiscoveryCriteria({ productType: "tires", scope: "vehicle_makes" })).toThrow();
    expect(() => parseCatalogDiscoveryCriteria({ productType: "battery", scope: "vehicle_years" })).toThrow("makeId");
    expect(() => parseCatalogDiscoveryCriteria({ productType: "battery", scope: "vehicle_makes", productId: "id" })).toThrow("solo se aplican");
    expect(parseCatalogDiscoveryCriteria({ productType: "battery", scope: "vehicle_applications", makeId: "id" }).year).toBeUndefined();
  });
  it("acepta búsqueda por vehículo y medida", () => {
    expect(parseTireSearchCriteria({
      mode: "vehicle",
      applicationId: "tire-application:abc",
    })).toMatchObject({ mode: "vehicle", applicationId: "tire-application:abc" });
    expect(parseTireSearchCriteria({ mode: "measure", category: "04" }))
      .toMatchObject({ mode: "measure", category: "04" });
  });

  it("rechaza motos por vehículo y cantidades inválidas", () => {
    expect(() => parseTireSearchCriteria({
      mode: "vehicle",
      applicationId: "tire-application:moto",
      category: "04",
    })).toThrow("no está disponible para motos");
    expect(() => parseTireSearchCriteria({ mode: "measure", category: "04", quantity: 0 }))
      .toThrow();
  });

  it("conserva la categoría de motos sin exigir bodega", () => {
    expect(parseStockCriteria({ category: "04" })).toEqual({
      category: "04",
      cityId: undefined,
      warehouseId: undefined,
    });
  });
});
