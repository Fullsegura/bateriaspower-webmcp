import { describe, expect, it, vi, afterEach } from "vitest";
import { discoverCatalog } from "@/lib/catalog-discovery";
import { discoverBatteryMakes, discoverBatteryApplications, searchVehicleBatteries } from "@/lib/battery-catalog";

describe("descubrimiento del catálogo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lista aplicaciones sin año y sus años disponibles para baterías", async () => {
    const make = discoverBatteryMakes()[0];
    const applications = await discoverCatalog({ productType: "battery", scope: "vehicle_applications", makeId: make.id });
    expect(applications.options.length).toBeGreaterThan(0);
    const years = await discoverCatalog({ productType: "battery", scope: "vehicle_years", makeId: make.id });
    for (const option of applications.options) {
      expect(years.options.some((entry) => entry.metadata?.year === option.metadata?.yearFrom)).toBe(true);
      expect(years.options.some((entry) => entry.metadata?.year === option.metadata?.yearTo)).toBe(true);
    }
  });

  it("filtra localidades por producto y ciudad con su inventario", async () => {
    const make = discoverBatteryMakes()[0];
    const app = discoverBatteryApplications(make.id)[0];
    const result = await searchVehicleBatteries({ applicationId: app.id, year: Number(app.metadata?.yearFrom) });
    const product = result.batteries[0];
    const location = product.locations.find((entry) => entry.cityId)!;
    const discovery = await discoverCatalog({
      productType: "battery", scope: "locations", productId: product.id, cityId: location.cityId,
    });
    expect(discovery.options.length).toBeGreaterThan(0);
    expect(discovery.options.every((entry) => entry.metadata?.cityId === location.cityId)).toBe(true);
    expect(discovery.options.find((entry) => entry.id === location.id)?.metadata?.inventory).toBe(location.inventory);
  });

  it("obtiene años de llantas mediante IDs exactos del proveedor", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ response: { car_brands: [{ _id: "make-a", name: "Marca A" }] } }))
      .mockResolvedValueOnce(Response.json({ response: [{ _id: "year-a", year: "2017" }, { _id: "year-b", year: "2021" }] })));
    const result = await discoverCatalog({ productType: "tire", scope: "vehicle_years", makeId: "make-a" });
    expect(result.options).toEqual([
      { id: "year-a", label: "2017", metadata: { year: 2017 } },
      { id: "year-b", label: "2021", metadata: { year: 2021 } },
    ]);
  });

  it("lista aplicaciones de todos los años sin repetir consultas de marca y años", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ response: { car_brands: [{ _id: "make-a", name: "Marca A" }] } }))
      .mockResolvedValueOnce(Response.json({ response: [{ _id: "year-a", year: "2017" }, { _id: "year-b", year: "2021" }] }))
      .mockResolvedValueOnce(Response.json({ response: [{ model: { _id: "model-a", name: "Modelo A" } }] }))
      .mockResolvedValueOnce(Response.json({ response: [{ model: { _id: "model-b", name: "Modelo A" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await discoverCatalog({ productType: "tire", scope: "vehicle_applications", makeId: "make-a" });
    expect(result.options.map((option) => option.metadata?.year)).toEqual([2017, 2021]);
    expect(new Set(result.options.map((option) => option.id)).size).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("filtra localidades de llantas por producto y ciudad sin coincidencias parciales", async () => {
    const sourceProduct = (id: string, city: string, quantity: number) => ({
      codigo_producto: id, nombre_producto: id, codigo_segmento: "02", brand: { name: "Marca A" },
      stock_bodegas: { [city]: [{ codigoBodega: "1", nombreBodega: "Local A", cantidad: quantity }] },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ response: { products: [
      { ...sourceProduct("product-a", "CITY-A", 3), stock_bodegas: {
        "CITY-A": [{ codigoBodega: "1", nombreBodega: "Local A", cantidad: 3 }],
        "CITY-B": [{ codigoBodega: "2", nombreBodega: "Local B", cantidad: 5 }],
      } },
      sourceProduct("product-ab", "CITY-A", 9),
    ] } })));
    const result = await discoverCatalog({ productType: "tire", scope: "locations", category: "02", productId: "product-a", cityId: "CITY-A" });
    expect(result.options.find((option) => option.id === "CITY-A:1")?.metadata?.quantity).toBe(3);
    expect(result.options.every((option) => option.id === "CITY-A" || option.metadata?.cityId === "CITY-A")).toBe(true);
  });
});
