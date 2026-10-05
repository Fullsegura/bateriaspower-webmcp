import { describe, expect, it } from "vitest";

import { parseCreateHandoffInput } from "@/features/handoff/validation";

function inputWithImage(image: string) {
  return {
    customerName: "Ana",
    transcript: [],
    context: {
      vehicle: "Toyota Corolla 2018",
      tire: {
        id: "sku-1",
        name: "R 225/65R17 PIRELLI",
        image,
        price: 123.05,
        quantity: 1,
        total: 123.05,
      },
    },
  };
}

describe("validación del contexto de handoff", () => {
  it("conserva el punto de entrega confirmado y rechaza coordenadas inválidas", () => {
    const input = inputWithImage("/products/bateriasecuador/40.png");
    const delivery = { latitude: -0.18, longitude: -78.46, address: "Av. Amazonas 123", reference: "Puerta principal" };
    expect(parseCreateHandoffInput({ ...input, context: { ...input.context, delivery } }).context.delivery).toEqual(delivery);
    expect(() => parseCreateHandoffInput({ ...input, context: { ...input.context, delivery: { ...delivery, latitude: 100 } } })).toThrow();
  });

  it("conserva una imagen del host público autorizado", () => {
    const parsed = parseCreateHandoffInput(
      inputWithImage("https://erpdurallanta.provedatos.com/catalog/llanta.jpg"),
    );

    expect(parsed.context.tire?.image)
      .toBe("https://erpdurallanta.provedatos.com/catalog/llanta.jpg");
  });

  it("descarta imágenes externas", () => {
    const parsed = parseCreateHandoffInput(
      inputWithImage("https://example.com/tire.png"),
    );

    expect(parsed.context.tire?.image).toBeNull();
  });

  it("acepta imágenes públicas de motos en PowerLlanta", () => {
    const image = "https://durallanta.com/durallantaoutlet/productos/04_015_0027_1.jpg";
    expect(parseCreateHandoffInput(inputWithImage(image)).context.tire?.image).toBe(image);
  });

  it("conserva el contexto de una batería del catálogo local", () => {
    const base = inputWithImage("/products/bateriasecuador/40.png?v=demo");
    const input = {
      ...base,
      context: {
        ...base.context,
        tire: { ...base.context.tire, kind: "battery" },
      },
    };

    const parsed = parseCreateHandoffInput(input);

    expect(parsed.context.tire).toMatchObject({
      kind: "battery",
      image: "/products/bateriasecuador/40.png?v=demo",
    });
  });
});
