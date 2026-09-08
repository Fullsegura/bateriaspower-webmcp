import { describe, expect, it } from "vitest";

import {
  createInitialCatalogState,
  runPrepareQuote,
} from "@/features/catalog/catalog-state";
import type { Quote, Tire } from "@/types/catalog";

describe("estado inicial del catálogo", () => {
  it("conserva la consulta recibida desde Fullsegura", () => {
    expect(createInitialCatalogState("Isuzu D-Max 2022 en Quito").query)
      .toBe("Isuzu D-Max 2022 en Quito");
  });

  it("mantiene la consulta predeterminada fuera del modo embebido", () => {
    expect(createInitialCatalogState().query).toBe("Toyota RAV4 2018 en Quito");
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
