import { describe, expect, it } from "vitest";

import { createQuote, getTireById } from "@/lib/catalog-search";
import type { Tire } from "@/types/catalog";

const tire: Tire = {
  id: "sku-1",
  code: "sku-1",
  name: "R 225/65R17 PRUEBA",
  brand: "Prueba",
  category: "02",
  categoryLabel: "Camionetas y SUV",
  width: "225",
  height: "65",
  rim: "17",
  size: "225/65R17",
  tread: "ATR",
  application: "AT",
  loadDescription: "850",
  speedDescription: "H",
  details: "Producto de prueba",
  price: {
    status: "available",
    listWithoutVat: 120,
    discountPercent: 10,
    unitWithoutVat: 100,
    ecoValue: 1,
    vatPercent: 15,
    unitKnownChargesTotal: 116.15,
  },
  warehouses: [{
    cityCode: "UIO",
    warehouseCode: "32",
    warehouseName: "EL INCA",
    quantity: 4,
  }],
  totalStock: 4,
  stockDiscrepancy: null,
  availability: {
    scope: "UIO",
    requestedQuantity: 2,
    availableUnits: 4,
    singleWarehouseCanFulfill: true,
    requiresMultipleWarehouses: false,
  },
  image: null,
  secondaryImages: [],
};

describe("catálogo de llantas", () => {
  it("busca únicamente dentro de los resultados actuales", () => {
    expect(getTireById([tire], "sku-1")).toEqual(tire);
    expect(getTireById([tire], "inexistente")).toBeNull();
  });

  it("calcula precio sin IVA y total de cargos conocidos por separado", () => {
    expect(createQuote([tire], "sku-1", 2)).toEqual({
      tireId: "sku-1",
      quantity: 2,
      warehouse: null,
      availableUnits: 4,
      requiresMultipleWarehouses: false,
      unitWithoutVat: 100,
      unitKnownChargesTotal: 116.15,
      subtotalWithoutVat: 200,
      ecoValueTotal: 2,
      vatPercent: 15,
      vatTotal: 30.3,
      totalKnownCharges: 232.3,
      priceStatus: "available",
    });
  });

  it("conserva y valida el local solicitado", () => {
    expect(createQuote([tire], "sku-1", 4, "El Inca").warehouse).toEqual(
      tire.warehouses[0],
    );
    expect(() => createQuote([tire], "sku-1", 5, "El Inca")).toThrow(
      "Stock insuficiente",
    );
  });

  it("rechaza productos y cantidades inválidas", () => {
    expect(() => createQuote([tire], "sku-1", 0)).toThrow();
    expect(() => createQuote([tire], "inexistente", 1)).toThrow();
  });
});
