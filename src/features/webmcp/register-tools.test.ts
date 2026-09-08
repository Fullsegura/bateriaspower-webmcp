import { describe, expect, it, vi } from "vitest";

import {
  baseTireTools,
  bindCatalogActions,
  prepareQuoteTool,
  resetTireSearchTool,
  resultTireTools,
  searchTiresTool,
  selectTireTool,
  summarizeTireStockTool,
} from "@/features/webmcp/tools/tires";
import type { CatalogActions, Tire } from "@/types/catalog";

const tire = { id: "sku-1", code: "sku-1", name: "Llanta" } as Tire;

describe("herramientas WebMCP", () => {
  it("define exactamente las cinco herramientas aprobadas", () => {
    expect([...baseTireTools, ...resultTireTools].map(({ name }) => name)).toEqual([
      "search_tires",
      "summarize_tire_stock",
      "reset_tire_search",
      "select_tire",
      "prepare_quote",
    ]);
  });

  it("conecta búsqueda, stock y cotización con las acciones visibles", async () => {
    const actions: CatalogActions = {
      setQuery: vi.fn(),
      search: vi.fn(async () => ({
        tires: [tire],
        queriedAt: "2026-09-07T20:00:00.000Z",
        source: "https://durallanta.com",
        note: "Stock reportado",
      })),
      summarizeStock: vi.fn(async () => ({
        category: "04" as const,
        groups: [],
        totalUnits: 0,
        queriedAt: "2026-09-07T20:00:00.000Z",
        source: "https://durallanta.com",
        note: "MOTO",
      })),
      selectTire: vi.fn(() => tire),
      prepareQuote: vi.fn(() => ({
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
        priceStatus: "available" as const,
      })),
      clearQuote: vi.fn(),
      reset: vi.fn(),
    };
    const unbind = bindCatalogActions(actions);

    await searchTiresTool.execute({ mode: "measure", category: "04", quantity: 1 });
    await summarizeTireStockTool.execute({ category: "04", warehouse: "ignorada" });
    selectTireTool.execute({ tireId: "sku-1" });
    prepareQuoteTool.execute({
      tireId: "sku-1",
      quantity: 2,
      quantityMode: "total",
      warehouse: "EL INCA",
    });
    resetTireSearchTool.execute({});

    expect(actions.search).toHaveBeenCalledWith({
      mode: "measure",
      category: "04",
      brand: undefined,
      city: undefined,
      quantity: 1,
      budget: undefined,
      width: undefined,
      height: undefined,
      rim: undefined,
    });
    expect(actions.summarizeStock).toHaveBeenCalledWith({
      category: "04",
      city: undefined,
      warehouse: "ignorada",
    });
    expect(actions.selectTire).toHaveBeenCalledWith("sku-1");
    expect(actions.prepareQuote).toHaveBeenCalledWith("sku-1", 2, "total", "EL INCA");
    expect(actions.reset).toHaveBeenCalledOnce();
    unbind();
  });

  it("rechaza un modo de cantidad ausente o inválido", async () => {
    const actions = {
      prepareQuote: vi.fn(),
    } as unknown as CatalogActions;
    const unbind = bindCatalogActions(actions);

    await expect(prepareQuoteTool.execute({
      tireId: "sku-1",
      quantity: 2,
    })).resolves.toEqual({
      ok: false,
      error: "quantityMode debe ser total o additional.",
    });
    expect(actions.prepareQuote).not.toHaveBeenCalled();
    unbind();
  });

  it("devuelve errores esperados al agente sin romper la invocación WebMCP", async () => {
    const actions = {
      search: vi.fn(async () => {
        throw new Error("El modelo es ambiguo. Opciones: RAV4 CVT, RAV4 LIMITED.");
      }),
    } as unknown as CatalogActions;
    const unbind = bindCatalogActions(actions);

    await expect(searchTiresTool.execute({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4",
      year: 2018,
    })).resolves.toEqual({
      ok: false,
      error: "El modelo es ambiguo. Opciones: RAV4 CVT, RAV4 LIMITED.",
    });
    unbind();
  });
});
