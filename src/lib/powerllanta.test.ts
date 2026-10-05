import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PowerLlantaError,
  discoverTireApplications,
  discoverTireMakes,
  normalizeProduct,
  searchTires,
  summarizeTireStock,
} from "@/lib/powerllanta";
import { parseTireSearchCriteria } from "@/lib/catalog-input";

function sourceProduct(overrides: Record<string, unknown> = {}) {
  return {
    codigo_producto: "06201503118233561",
    nombre_producto: "R 225/65R17 PIRELLI SCORPION ATR",
    codigo_segmento: "02",
    ancho: "225",
    alto: "65",
    rin: "17",
    brand: { name: "PIRELLI" },
    precio: "200",
    descuento: "20",
    precioDescontado: 160,
    precioDescontadoEcoValor: 161,
    iva: "15",
    precioFinal: 185.15,
    stock_bodegas: {
      UIO: [
        { codigoBodega: "32", nombreBodega: "EL INCA", cantidad: "3" },
        { codigoBodega: "36", nombreBodega: "PONCIANO", cantidad: "2" },
      ],
    },
    total_stock: 5,
    ...overrides,
  };
}

const makesResponse = () => Response.json({
  response: { car_brands: [{ _id: "brand-1", name: "TOYOTA" }] },
  error: "",
});
const yearsResponse = () => Response.json({
  response: [{ _id: "year-1", year: "2018" }],
  error: "",
});
const modelsResponse = () => Response.json({
  response: [{ model: { _id: "model-1", name: "RAV4 CVT" } }],
  error: "",
});

describe("catálogo PowerAuto de llantas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("separa precios y asigna IDs exactos a marca, ciudad y bodega", () => {
    const tire = normalizeProduct(sourceProduct());
    expect(tire).toMatchObject({
      size: "225/65R17",
      brand: "PIRELLI",
      brandId: "tire-brand:PIRELLI",
      price: {
        status: "available",
        unitWithoutVat: 160,
        ecoValue: 1,
        vatPercent: 15,
        unitKnownChargesTotal: 185.15,
      },
    });
    expect(tire.warehouses[0]).toMatchObject({
      cityId: "UIO",
      warehouseId: "UIO:32",
    });
  });

  it("repara texto del proveedor y conserva validaciones técnicas", () => {
    expect(normalizeProduct(sourceProduct({
      detalles: "Llanta para todas las Ã©pocas del aÃ±o",
    })).details).toBe("Llanta para todas las épocas del año");
    expect(normalizeProduct(sourceProduct({ precioFinal: 99 })).price.status).toBe("confirm");
  });

  it("descubre marcas y aplicaciones exactas antes de buscar", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makesResponse())
      .mockResolvedValueOnce(makesResponse())
      .mockResolvedValueOnce(yearsResponse())
      .mockResolvedValueOnce(modelsResponse());
    vi.stubGlobal("fetch", fetchMock);

    const makes = await discoverTireMakes();
    const applications = await discoverTireApplications(makes[0].id, 2018);

    expect(makes).toEqual([{ id: "brand-1", label: "TOYOTA" }]);
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({
      label: "RAV4 CVT",
      metadata: { make: "TOYOTA", model: "RAV4 CVT", year: 2018 },
    });
    expect(parseTireSearchCriteria({ mode: "vehicle", applicationId: applications[0].id }))
      .toMatchObject({ applicationId: applications[0].id });
  });

  it("busca por applicationId y descarta medidas ajenas", async () => {
    const discoveryFetch = vi.fn()
      .mockResolvedValueOnce(makesResponse())
      .mockResolvedValueOnce(yearsResponse())
      .mockResolvedValueOnce(modelsResponse());
    vi.stubGlobal("fetch", discoveryFetch);
    const application = (await discoverTireApplications("brand-1", 2018))[0];

    const searchFetch = vi.fn()
      .mockResolvedValueOnce(makesResponse())
      .mockResolvedValueOnce(yearsResponse())
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(Response.json({
        response: [{ specifications: [{ width: "225", high: "65", rin: "17" }] }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: {
          products: [sourceProduct(), sourceProduct({ codigo_producto: "wrong", rin: "16" })],
        },
        error: "",
      }));
    vi.stubGlobal("fetch", searchFetch);

    const result = await searchTires({
      mode: "vehicle",
      applicationId: application.id,
      quantity: 1,
    });

    expect(result.resolvedVehicle).toMatchObject({
      make: "TOYOTA",
      model: "RAV4 CVT",
      year: 2018,
      sizes: ["225/65R17"],
    });
    expect(result.tires.map(({ code }) => code)).toEqual(["06201503118233561"]);
  });

  it("rechaza un applicationId inventado sin interpretarlo", async () => {
    await expect(searchTires({
      mode: "vehicle",
      applicationId: "RAV4 2018",
    })).rejects.toBeInstanceOf(PowerLlantaError);
  });

  it("no elimina puntuación de medidas recibidas para forzar coincidencias", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      response: { products: [sourceProduct()] }, error: "",
    })));
    const result = await searchTires({ mode: "measure", width: "2.25", height: "65", rim: "17" });
    expect(result.tires).toEqual([]);
  });

  it("usa IDs exactos para resumir stock", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      response: { products: [sourceProduct()] },
      error: "",
    })));

    const summary = await summarizeTireStock({
      category: "02",
      cityId: "UIO",
      warehouseId: "UIO:32",
    });
    expect(summary.groups).toEqual([expect.objectContaining({
      cityCode: "UIO",
      warehouseCode: "32",
      quantity: 3,
    })]);
  });
});
