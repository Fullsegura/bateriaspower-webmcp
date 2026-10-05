import { describe, expect, it } from "vitest";

import { requireBatterySearchInputs, requireDiscoveredId, requireDiscoveryInputs, upsertDiscovery } from "@/lib/catalog-provenance";
import type { CatalogDiscoveryResult } from "@/types/catalog";

const applications: CatalogDiscoveryResult = {
  productType: "battery",
  scope: "vehicle_applications",
  context: { makeId: "make-1", year: 2020 },
  options: [{ id: "application-1", label: "Modelo A" }],
  queriedAt: "2026-10-04T12:00:00.000Z",
};

describe("procedencia de IDs", () => {
  it("reutiliza un mismo ID para años cubiertos por un descubrimiento sin año", () => {
    const ranged = {
      ...applications,
      context: { makeId: "make-1" },
      options: [{ id: "application-1", label: "Modelo A", metadata: { yearFrom: 2010, yearTo: 2020 } }],
    };
    for (const year of [2010, 2015, 2020]) {
      expect(() => requireBatterySearchInputs([ranged], { applicationId: "application-1", year })).not.toThrow();
    }
    expect(() => requireBatterySearchInputs([ranged], { applicationId: "application-1", year: 2021 })).toThrow();
    expect(() => requireBatterySearchInputs([{ ...ranged, context: { makeId: "make-1", year: 2010 } }], {
      applicationId: "application-1", year: 2015,
    })).toThrow();
  });
  it("exige procedencia de makeId antes de descubrir años o aplicaciones", () => {
    for (const productType of ["tire", "battery"] as const) {
      for (const scope of ["vehicle_years", "vehicle_applications"] as const) {
        expect(() => requireDiscoveryInputs([], { productType, scope, makeId: "make-1" })).toThrow();
        expect(() => requireDiscoveryInputs([{
          productType, scope: "vehicle_makes", context: {}, queriedAt: applications.queriedAt,
          options: [{ id: "make-1", label: "Marca A" }],
        }], { productType, scope, makeId: "make-1" })).not.toThrow();
      }
    }
  });
  it("acepta un ID descubierto únicamente en su producto y contexto", () => {
    expect(() => requireDiscoveredId(
      [applications],
      "battery",
      "vehicle_applications",
      "application-1",
      { year: 2020 },
    )).not.toThrow();

    expect(() => requireDiscoveredId(
      [applications],
      "battery",
      "vehicle_applications",
      "application-1",
      { year: 2021 },
    )).toThrow("no pertenece a un descubrimiento vigente");
  });

  it("rechaza un ID existente en otro producto o alcance", () => {
    expect(() => requireDiscoveredId(
      [applications],
      "tire",
      "vehicle_applications",
      "application-1",
    )).toThrow();
    expect(() => requireDiscoveredId(
      [applications],
      "battery",
      "product_brands",
      "application-1",
    )).toThrow();
  });

  it("reutiliza el último descubrimiento del mismo contexto", () => {
    const updated = {
      ...applications,
      options: [{ id: "application-2", label: "Modelo B" }],
      queriedAt: "2026-10-04T12:01:00.000Z",
    };
    const discoveries = upsertDiscovery([applications], updated);

    expect(discoveries).toEqual([updated]);
    expect(() => requireDiscoveredId(
      discoveries,
      "battery",
      "vehicle_applications",
      "application-1",
      { year: 2020 },
    )).toThrow();
  });

  it("conserva aplicaciones si la marca sigue vigente e invalida las de una marca retirada", () => {
    const makes: CatalogDiscoveryResult = {
      productType: "battery", scope: "vehicle_makes", context: {},
      options: [{ id: "make-1", label: "Marca A" }], queriedAt: applications.queriedAt,
    };
    expect(upsertDiscovery([applications], makes)).toContainEqual(applications);
    expect(upsertDiscovery([applications], { ...makes, options: [] })).not.toContainEqual(applications);
  });
});
