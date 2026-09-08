import { describe, expect, it } from "vitest";

import { parseStockCriteria, parseTireSearchCriteria } from "@/lib/catalog-input";

describe("validación de consultas", () => {
  it("acepta búsqueda por vehículo y medida", () => {
    expect(parseTireSearchCriteria({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4 CVT AC 2.0 5P 4x2 TA",
      year: 2018,
    })).toMatchObject({ mode: "vehicle", year: 2018 });
    expect(parseTireSearchCriteria({ mode: "measure", category: "04" }))
      .toMatchObject({ mode: "measure", category: "04" });
  });

  it("rechaza motos por vehículo y cantidades inválidas", () => {
    expect(() => parseTireSearchCriteria({
      mode: "vehicle",
      make: "Honda",
      model: "CBR",
      year: 2020,
      category: "04",
    })).toThrow("no está disponible para motos");
    expect(() => parseTireSearchCriteria({ mode: "measure", category: "04", quantity: 0 }))
      .toThrow();
  });

  it("conserva la categoría de motos sin exigir bodega", () => {
    expect(parseStockCriteria({ category: "04" })).toEqual({
      category: "04",
      city: undefined,
      warehouse: undefined,
    });
  });
});
