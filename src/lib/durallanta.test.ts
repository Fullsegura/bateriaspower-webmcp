import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DurallantaError,
  normalizeProduct,
  searchTires,
  summarizeTireStock,
} from "@/lib/durallanta";

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

describe("normalización Durallanta", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("separa precio neto, EcoValor, IVA y stock por bodega", () => {
    const tire = normalizeProduct(sourceProduct());
    expect(tire.size).toBe("225/65R17");
    expect(tire.price).toMatchObject({
      status: "available",
      unitWithoutVat: 160,
      ecoValue: 1,
      vatPercent: 15,
      unitKnownChargesTotal: 185.15,
    });
    expect(tire.totalStock).toBe(5);
    expect(tire.stockDiscrepancy).toBeNull();
  });

  it("repara texto UTF-8 interpretado como Latin-1 por la fuente", () => {
    const tire = normalizeProduct(sourceProduct({
      detalles: "Llanta para todas las Ã©pocas del aÃ±o",
    }));
    expect(tire.details).toBe("Llanta para todas las épocas del año");
  });

  it("omite una descripción cuando la fuente ya perdió caracteres", () => {
    const tire = normalizeProduct(sourceProduct({
      detalles: "Diseï¿½o para conducciï¿½n silenciosa",
    }));
    expect(tire.details).toBe("");
  });

  it("marca precio por confirmar cuando el valor base es cero", () => {
    const tire = normalizeProduct(sourceProduct({
      precio: 0,
      precioDescontado: 0,
      precioDescontadoEcoValor: 1,
      precioFinal: 1.15,
    }));
    expect(tire.price.status).toBe("confirm");
    expect(tire.price.unitWithoutVat).toBeNull();
    expect(tire.price.unitKnownChargesTotal).toBeNull();
  });

  it("marca precio por confirmar cuando el total contradice EcoValor e IVA", () => {
    expect(normalizeProduct(sourceProduct({ precioFinal: 99 })).price.status)
      .toBe("confirm");
  });

  it("reconoce motos aunque el segmento público sea 999", () => {
    const tire = normalizeProduct(sourceProduct({
      codigo_segmento: "999",
      descripcion_segmento: "MOTOS",
      type: "MOTO",
    }));
    expect(tire.category).toBe("04");
    expect(tire.categoryLabel).toBe("Motos");
  });

  it("señala contradicciones entre total y detalle", () => {
    expect(normalizeProduct(sourceProduct({ total_stock: 7 })).stockDiscrepancy)
      .toContain("contradice");
  });

  it("resuelve vehículo y descarta medidas distintas a la reportada", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        response: { car_brands: [{ _id: "brand-1", name: "TOYOTA" }] },
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ _id: "year-1", year: "2018" }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ model: { _id: "model-1", name: "RAV4 CVT" } }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ specifications: [{ width: "225", high: "65", rin: "17" }] }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: {
          products: [
            sourceProduct(),
            sourceProduct({ codigo_producto: "wrong", rin: "16" }),
          ],
        },
        error: "",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchTires({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4 CVT",
      year: 2018,
      quantity: 1,
    });

    expect(result.resolvedVehicle?.sizes).toEqual(["225/65R17"]);
    expect(result.tires.map(({ code }) => code)).toEqual(["06201503118233561"]);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({
      width: "225",
      high: "65",
      rin: "17",
      type: "1",
    });
  });

  it("devuelve variantes cuando el modelo del vehículo es ambiguo", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        response: { car_brands: [{ _id: "brand-1", name: "TOYOTA" }] },
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ _id: "year-1", year: "2018" }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [
          { model: { _id: "model-1", name: "RAV4 CVT" } },
          { model: { _id: "model-2", name: "RAV4 LIMITED" } },
        ],
        error: "",
      })));

    const error = await searchTires({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4",
      year: 2018,
      quantity: 1,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DurallantaError);
    expect(error).toMatchObject({
      status: 422,
      message: "El modelo es ambiguo; selecciona una variante exacta.",
      details: ["RAV4 CVT", "RAV4 LIMITED"],
    });
  });

  it("no convierte una coincidencia parcial única en una versión exacta", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        response: { car_brands: [{ _id: "brand-1", name: "TOYOTA" }] },
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ _id: "year-1", year: "2018" }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ model: { _id: "model-1", name: "RAV4 LIMITED" } }],
        error: "",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await searchTires({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4",
      year: 2018,
      quantity: 1,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DurallantaError);
    expect(error).toMatchObject({
      status: 422,
      message: "El modelo no coincide de forma exacta; confirma la opción registrada.",
      details: ["RAV4 LIMITED"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("no inventa una medida cuando Durallanta no reporta compatibilidad", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        response: { car_brands: [{ _id: "brand-1", name: "TOYOTA" }] },
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ _id: "year-1", year: "2018" }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ model: { _id: "model-1", name: "RAV4 LIMITED" } }],
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [{ specifications: [] }],
        error: "",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchTires({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4 LIMITED",
      year: 2018,
      quantity: 1,
    });

    expect(result.resolvedVehicle).toMatchObject({
      make: "TOYOTA",
      model: "RAV4 LIMITED",
      year: 2018,
      sizes: [],
    });
    expect(result.tires).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rechaza un año no registrado y devuelve solo los años de la fuente", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        response: { car_brands: [{ _id: "brand-1", name: "TOYOTA" }] },
        error: "",
      }))
      .mockResolvedValueOnce(Response.json({
        response: [
          { _id: "year-1", year: "2018" },
          { _id: "year-2", year: "2019" },
        ],
        error: "",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await searchTires({
      mode: "vehicle",
      make: "Toyota",
      model: "RAV4 LIMITED",
      year: 2020,
      quantity: 1,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DurallantaError);
    expect(error).toMatchObject({
      status: 422,
      message: "Durallanta no registra Toyota para el año 2020.",
      details: [2018, 2019],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignora ciudad y bodega para el único stock de motos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      response: {
        products: [sourceProduct({
          codigo_segmento: "999",
          type: "MOTO",
          stock_bodegas: {
            MOTO: [{ codigoBodega: "99", nombreBodega: "MOTOS_ECOMMERCE", cantidad: 12 }],
          },
          total_stock: null,
        })],
      },
      error: "",
    })));

    const summary = await summarizeTireStock({
      category: "04",
      city: "Quito",
      warehouse: "bodega 1",
    });
    expect(summary.totalUnits).toBe(12);
    expect(summary.groups[0]).toMatchObject({
      cityCode: "MOTO",
      warehouseCode: "99",
      warehouseName: "MOTOS_ECOMMERCE",
    });
  });
});
