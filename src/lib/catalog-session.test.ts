import { describe, expect, it, vi, afterEach } from "vitest";
import { POST as startSession } from "@/app/api/catalog/session/route";
import { POST as discover } from "@/app/api/catalog/discovery/route";
import { POST as searchBattery } from "@/app/api/catalog/batteries/search/route";
import { POST as searchTire } from "@/app/api/catalog/search/route";
import { requireCatalogSession, requireSessionProduct } from "@/lib/catalog-session";
import * as batteryCatalog from "@/lib/battery-catalog";
import type { CatalogDiscoveryResult } from "@/types/catalog";

const request = (input: unknown, sessionId?: string) => new Request("http://localhost/api/catalog", {
  method: "POST",
  headers: { "content-type": "application/json", ...(sessionId ? { "x-catalog-session": sessionId } : {}) },
  body: JSON.stringify(input),
});
const session = async () => (await (await startSession()).json()).sessionId as string;

describe("procedencia en endpoints del catálogo", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each(["tire", "battery"] as const)("una búsqueda válida fallida de %s invalida los productos anteriores en el servidor", async (productType) => {
    const id = await session();
    const stored = requireCatalogSession(request({}, id));
    stored.products = { productType: "battery", items: [{ id: "old-product" } as never] };
    const criteria = productType === "battery"
      ? { applicationId: "application", year: 2020 }
      : { mode: "vehicle", applicationId: "tire-application:" + Buffer.from(JSON.stringify({
        makeId: "make", make: "MAKE", yearId: "year", year: 2020, modelId: "model", model: "MODEL",
      })).toString("base64url") };
    stored.discoveries = [{
      productType, scope: "vehicle_applications", context: { year: 2020 },
      options: [{ id: criteria.applicationId, label: "MODEL", metadata: { yearFrom: 2020, yearTo: 2020 } }],
      queriedAt: new Date().toISOString(),
    }];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Proveedor no disponible")));
    vi.spyOn(batteryCatalog, "searchVehicleBatteries").mockRejectedValue(new Error("Proveedor no disponible"));
    const response = await (productType === "battery" ? searchBattery : searchTire)(request(criteria, id));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(stored.products).toBeNull();
    expect(() => requireSessionProduct(stored, "battery", "old-product")).toThrow();
  });

  it("rechaza llamadas sin sesión y IDs de otra sesión", async () => {
    expect((await discover(request({ productType: "battery", scope: "vehicle_makes" }))).status).toBe(400);
    const first = await session();
    const second = await session();
    const makes = await (await discover(request({ productType: "battery", scope: "vehicle_makes" }, first))).json() as CatalogDiscoveryResult;
    expect((await discover(request({ productType: "battery", scope: "vehicle_applications", makeId: makes.options[0].id }, second))).status).toBe(400);
    const apps = await (await discover(request({ productType: "battery", scope: "vehicle_applications", makeId: makes.options[0].id }, first))).json() as CatalogDiscoveryResult;
    const criteria = { applicationId: apps.options[0].id, year: apps.options[0].metadata?.yearFrom };
    expect((await searchBattery(request(criteria, second))).status).toBe(400);
    const resultResponse = await searchBattery(request(criteria, first));
    expect(resultResponse.status).toBe(200);
    const result = await resultResponse.json();
    const productId = result.batteries[0].id;
    const locations = await (await discover(request({ productType: "battery", scope: "locations", productId }, first))).json() as CatalogDiscoveryResult;
    const city = locations.options.find((option) => option.metadata?.type === "city")!;
    const scoped = await discover(request({ productType: "battery", scope: "locations", productId, cityId: city.id }, first));
    expect(scoped.status).toBe(200);
    const scopedResult = await scoped.json() as CatalogDiscoveryResult;
    expect(scopedResult.options.length).toBeGreaterThan(0);
    expect(scopedResult.options.every((option) => option.metadata?.cityId === city.id)).toBe(true);
    expect(scopedResult.options.every((option) => Number.isInteger(option.metadata?.inventory))).toBe(true);
    expect((await searchBattery(request({ ...criteria, year: 1900 }, first))).status).toBe(400);
  });

  it("rechaza producto ajeno al resultado actual y ciudad ajena al descubrimiento", async () => {
    const id = await session();
    expect((await discover(request({ productType: "battery", scope: "locations", productId: "be-48-high-power" }, id))).status).toBe(400);
    expect((await discover(request({ productType: "battery", scope: "locations", cityId: "battery-city:quito" }, id))).status).toBe(400);
  });

  it("rechaza applicationId de llantas sin procedencia antes de consultar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await searchTire(request({ mode: "vehicle", applicationId: "tire-application:inventada" }, await session()));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expira la sesión y no reutiliza descubrimientos previos", async () => {
    const id = await session();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    expect(() => requireCatalogSession(request({}, id))).toThrow("expiró");
  });
});
