import { describe, expect, it } from "vitest";

import { catalogReducer, createInitialCatalogState } from "@/features/catalog/catalog-state";
import { parseBatteryAlternatives } from "@/lib/battery-input";
import { createCatalogSession, presentSessionBatteryAlternatives, readSessionBatteryCatalog, requireCatalogSession } from "@/lib/catalog-session";

function session(id = createCatalogSession()) {
  return requireCatalogSession(new Request("http://localhost", { headers: { "x-catalog-session": id } }));
}

describe("alternativas de baterías elegidas por el modelo", () => {
  it("expone las fichas sin filtrar similitud y conserva el orden de IDs elegido", () => {
    const context = session();
    const listing = readSessionBatteryCatalog(context);
    expect(listing.products).toHaveLength(32);
    expect(listing.unknownFields).toContain("ccaStandard");
    const ids = [listing.products[2].id, listing.products[0].id];
    expect(presentSessionBatteryAlternatives(context, listing.listingId, ids).map((item) => item.id)).toEqual(ids);
  });

  it("rechaza IDs ajenos, de otra sesión y de una consulta anterior", () => {
    const first = session();
    const second = session();
    const listing = readSessionBatteryCatalog(first);
    const ids = [listing.products[0].id];
    expect(() => presentSessionBatteryAlternatives(second, listing.listingId, ids)).toThrow("sesión");
    expect(() => presentSessionBatteryAlternatives(first, listing.listingId, ["inventado"])).toThrow("resultados");
    readSessionBatteryCatalog(first);
    expect(() => presentSessionBatteryAlternatives(first, listing.listingId, ids)).toThrow("vigente");
  });

  it("limpia selecciones y cotizaciones al comparar y no declara vehículo compatible", () => {
    const context = session();
    const listing = readSessionBatteryCatalog(context);
    const items = presentSessionBatteryAlternatives(context, listing.listingId, [listing.products[0].id]);
    let state = createInitialCatalogState();
    state = { ...state, selectedBatteryId: "anterior", selectedTireId: "anterior",
      batteryQuote: { batteryId: "anterior" } as never, quote: { tireId: "anterior" } as never };
    state = catalogReducer(state, { type: "battery-catalog-read", listing });
    state = catalogReducer(state, { type: "battery-alternatives", result: { batteries: items,
      queriedAt: listing.queriedAt, resolvedVehicle: null, source: "Catálogo", note: "Comparación" } });
    expect(state.batteries).toEqual(items);
    expect(state.selectedBatteryId).toBeNull();
    expect(state.selectedTireId).toBeNull();
    expect(state.batteryQuote).toBeNull();
    expect(state.quote).toBeNull();
    expect(state.batteryCriteria).toBeNull();
  });

  it("valida el contrato sin interpretar nombres o intención", () => {
    for (const batteryIds of [[], ["a", "a"], ["a", 5], Array(6).fill("a")]) {
      expect(() => parseBatteryAlternatives({ listingId: "vigente", batteryIds })).toThrow();
    }
    expect(() => parseBatteryAlternatives({ listingId: "vigente", batteryIds: ["a"], capacity: 50 })).toThrow();
  });
});
