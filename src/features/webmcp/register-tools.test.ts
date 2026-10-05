import { describe, expect, it, vi } from "vitest";

import { requestAdvisorHandoffTool } from "@/features/handoff/webmcp-tool";
import {
  allBatteryTools,
  prepareBatteryQuoteTool,
  searchVehicleBatteriesTool,
  selectBatteryTool,
} from "@/features/webmcp/tools/batteries";
import { discoverCatalogTool } from "@/features/webmcp/tools/discovery";
import {
  baseTireTools,
  bindCatalogActions,
  prepareQuoteTool,
  resetCatalogTool,
  resultTireTools,
  searchTiresTool,
  selectTireTool,
  summarizeTireStockTool,
} from "@/features/webmcp/tools/tires";
import type { Battery, CatalogActions, Tire } from "@/types/catalog";

const tire = { id: "sku-1", code: "sku-1", name: "Llanta" } as Tire;
const battery = {
  id: "battery-1",
  code: "N40",
  name: "Batería N40",
  locations: [{ id: "battery-location:Quito%20Norte", location: "Quito Norte", inventory: 8 }],
} as Battery;

describe("herramientas WebMCP", () => {
  it("define exactamente las herramientas de llantas, baterías y handoff", () => {
    expect([
      discoverCatalogTool,
      ...baseTireTools,
      ...resultTireTools,
      ...allBatteryTools,
      requestAdvisorHandoffTool,
    ].map(({ name }) => name)).toEqual([
      "discover_catalog",
      "search_tires",
      "summarize_tire_stock",
      "reset_catalog",
      "select_tire",
      "prepare_quote",
      "search_vehicle_batteries",
      "select_battery",
      "prepare_battery_quote",
      "read_battery_catalog",
      "present_battery_alternatives",
      "request_advisor_handoff",
    ]);
  });

  it("conecta búsqueda, stock y cotización con las acciones visibles", async () => {
    const actions: CatalogActions = {
      setQuery: vi.fn(),
      readBatteryCatalog: vi.fn(),
      presentBatteryAlternatives: vi.fn(),
      discover: vi.fn(async (criteria) => ({
        productType: criteria.productType,
        scope: criteria.scope,
        context: { makeId: criteria.makeId, year: criteria.year },
        options: [{ id: "make-1", label: "CHEVROLET" }],
        queriedAt: "2026-09-07T20:00:00.000Z",
      })),
      search: vi.fn(async () => ({
        tires: [tire],
        queriedAt: "2026-09-07T20:00:00.000Z",
        source: "PowerLlanta",
        note: "Stock reportado",
      })),
      searchBatteries: vi.fn(async () => ({
        batteries: [battery],
        queriedAt: "2026-09-07T20:00:00.000Z",
        source: "Catálogo PowerAuto",
        note: "Inventario por localidad.",
        resolvedVehicle: {
          make: "CHEVROLET",
          model: "SAIL",
          year: 2020,
          engine: "1.4",
        },
      })),
      summarizeStock: vi.fn(async () => ({
        category: "04" as const,
        groups: [],
        totalUnits: 0,
        queriedAt: "2026-09-07T20:00:00.000Z",
        source: "PowerLlanta",
        note: "MOTO",
      })),
      selectTire: vi.fn(() => tire),
      selectBattery: vi.fn(() => battery),
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
      prepareBatteryQuote: vi.fn(() => ({
        batteryId: battery.id,
        quantity: 2,
        location: battery.locations[0],
        availableUnits: battery.locations[0].inventory,
        unitPrice: 100,
        total: 200,
      })),
      clearQuote: vi.fn(),
      reset: vi.fn(),
    };
    const unbind = bindCatalogActions(actions);

    await discoverCatalogTool.execute({ productType: "battery", scope: "vehicle_makes" });
    await searchTiresTool.execute({ mode: "measure", category: "04", quantity: 1 });
    await summarizeTireStockTool.execute({ category: "04", warehouseId: "ignorada" });
    selectTireTool.execute({ tireId: "sku-1" });
    prepareQuoteTool.execute({
      tireId: "sku-1",
      quantity: 2,
      quantityMode: "total",
      warehouseId: "CUE:01",
    });
    await searchVehicleBatteriesTool.execute({
      applicationId: "battery-application:sail",
      year: 2020,
    });
    await selectBatteryTool.execute({
      batteryId: battery.id,
      locationId: "battery-location:Santo%20Domingo",
    });
    prepareBatteryQuoteTool.execute({
      batteryId: battery.id,
      quantity: 2,
      locationId: "battery-location:Quito%20Norte",
    });
    resetCatalogTool.execute({});

    const execution = expect.objectContaining({
      signal: expect.any(AbortSignal),
      isCurrent: expect.any(Function),
    });
    expect(actions.discover).toHaveBeenCalledWith({
      productType: "battery",
      scope: "vehicle_makes",
      makeId: undefined,
      year: undefined,
      category: undefined,
      productId: undefined,
      cityId: undefined,
    }, execution);
    expect(actions.search).toHaveBeenCalledWith({
      mode: "measure",
      category: "04",
      productBrandId: undefined,
      cityId: undefined,
      quantity: 1,
      budget: undefined,
      width: undefined,
      height: undefined,
      rim: undefined,
    }, execution);
    expect(actions.summarizeStock).toHaveBeenCalledWith({
      category: "04",
      cityId: undefined,
      warehouseId: "ignorada",
    }, execution);
    expect(actions.selectTire).toHaveBeenCalledWith("sku-1", execution);
    expect(actions.prepareQuote).toHaveBeenCalledWith(
      "sku-1",
      2,
      "total",
      "CUE:01",
      execution,
    );
    expect(actions.searchBatteries).toHaveBeenCalledWith({
      applicationId: "battery-application:sail",
      year: 2020,
    }, execution);
    expect(actions.selectBattery).toHaveBeenCalledWith(
      battery.id,
      "battery-location:Santo%20Domingo",
      execution,
    );
    expect(actions.prepareBatteryQuote).toHaveBeenCalledWith(
      battery.id,
      2,
      "battery-location:Quito%20Norte",
      execution,
    );
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
      applicationId: "tire-application:test",
    })).resolves.toEqual({
      ok: false,
      error: "El modelo es ambiguo. Opciones: RAV4 CVT, RAV4 LIMITED.",
    });
    unbind();
  });

  it("una limpieza anterior no desactiva el binding más reciente", async () => {
    const first = bindCatalogActions({ reset: vi.fn() } as unknown as CatalogActions);
    const currentActions = { reset: vi.fn() } as unknown as CatalogActions;
    const current = bindCatalogActions(currentActions);

    first();
    await resetCatalogTool.execute({});

    expect(currentActions.reset).toHaveBeenCalledOnce();
    current();
  });
});
