import { describe, expect, it } from "vitest";

import {
  BatteryCatalogError,
  createBatteryQuote,
  discoverBatteryApplications,
  discoverBatteryMakes,
  searchVehicleBatteries,
} from "@/lib/battery-catalog";
import { parseBatterySearchCriteria } from "@/lib/battery-input";

function requireOption<T extends { label: string }>(options: T[], label: string): T {
  const option = options.find((entry) => entry.label === label);
  if (!option) throw new Error(`No existe la opción ${label}.`);
  return option;
}

describe("catálogo de baterías", () => {
  it("acepta sin truncar todas las aplicaciones emitidas por el catálogo", async () => {
    const applications = discoverBatteryMakes().flatMap((make) => discoverBatteryApplications(make.id));
    expect(applications.some(({ id }) => id.length > 160)).toBe(true);
    for (const application of applications) {
      const criteria = parseBatterySearchCriteria({
        applicationId: application.id,
        year: application.metadata!.yearFrom,
      });
      expect(criteria.applicationId).toBe(application.id);
      const result = await searchVehicleBatteries(criteria);
      expect(result.resolvedVehicle?.year).toBe(criteria.year);
    }
  });
  it("descubre marcas y aplicaciones con IDs canónicos", () => {
    const make = requireOption(discoverBatteryMakes(), "CHEVROLET");
    const application = requireOption(
      discoverBatteryApplications(make.id, 2020),
      "SAIL · 1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    );

    expect(make.id).toMatch(/^battery-make:/);
    expect(application.id).toMatch(/^battery-application:/);
    expect(application.metadata).toMatchObject({
      make: "CHEVROLET",
      model: "SAIL",
      engine: "1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    });
  });

  it("busca únicamente mediante una aplicación descubierta", async () => {
    const make = requireOption(discoverBatteryMakes(), "CHEVROLET");
    const application = requireOption(
      discoverBatteryApplications(make.id, 2020),
      "SAIL · 1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    );
    const result = await searchVehicleBatteries({
      applicationId: application.id,
      year: 2020,
    });

    expect(result.batteries.map((battery) => battery.id)).toEqual([
      "be-n40-full-equipo",
      "be-n40-high-power",
    ]);
    expect(result.resolvedVehicle).toEqual({
      make: "CHEVROLET",
      model: "SAIL",
      year: 2020,
      engine: "1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    });
    expect(result.batteries[0].locations.every(({ id, inventory }) =>
      id.startsWith("battery-location:") && Number.isInteger(inventory) && inventory >= 0
    )).toBe(true);
  });

  it("rechaza IDs inexistentes o fuera del año descubierto", async () => {
    await expect(searchVehicleBatteries({
      applicationId: "battery-application:inventada",
      year: 2020,
    })).rejects.toBeInstanceOf(BatteryCatalogError);

    const make = requireOption(discoverBatteryMakes(), "CHEVROLET");
    const application = requireOption(
      discoverBatteryApplications(make.id, 2020),
      "SAIL · 1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    );
    await expect(searchVehicleBatteries({
      applicationId: application.id,
      year: 1900,
    })).rejects.toMatchObject({ status: 422 });
  });

  it("calcula la cotización por el ID exacto de la localidad visible", async () => {
    const make = requireOption(discoverBatteryMakes(), "CHEVROLET");
    const application = requireOption(
      discoverBatteryApplications(make.id, 2020),
      "SAIL · 1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    );
    const result = await searchVehicleBatteries({ applicationId: application.id, year: 2020 });
    const location = result.batteries[0].locations[0];

    expect(createBatteryQuote(
      result.batteries,
      result.batteries[0].id,
      2,
      location.id,
    )).toMatchObject({
      batteryId: result.batteries[0].id,
      quantity: 2,
      location,
    });
  });

  it("rechaza una localidad ajena al resultado o sin inventario suficiente", async () => {
    const make = requireOption(discoverBatteryMakes(), "CHEVROLET");
    const application = requireOption(
      discoverBatteryApplications(make.id, 2020),
      "SAIL · 1,4; 1.4I NEW; 1.5I; LS 1.5; LS STD 1.5; 1,6",
    );
    const result = await searchVehicleBatteries({ applicationId: application.id, year: 2020 });
    const battery = {
      ...result.batteries[0],
      locations: [{ id: "battery-location:Quito%20Norte", location: "Quito Norte", inventory: 1 }],
    };

    expect(() => createBatteryQuote([battery], battery.id, 1, "battery-location:otra"))
      .toThrow("La localidad no existe para esta batería.");
    expect(() => createBatteryQuote([battery], battery.id, 2, battery.locations[0].id))
      .toThrow("Quito Norte reporta 1 unidades; no alcanza para 2.");
  });
});
