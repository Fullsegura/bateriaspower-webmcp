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

  it("acepta imágenes públicas de motos en Durallanta", () => {
    const image = "https://durallanta.com/durallantaoutlet/productos/04_015_0027_1.jpg";
    expect(parseCreateHandoffInput(inputWithImage(image)).context.tire?.image).toBe(image);
  });
});
