import { describe, expect, it } from "vitest";

import { parseCreateHandoffInput } from "@/features/handoff/validation";

function inputWithImage(image: string) {
  return {
    customerName: "Ana",
    transcript: [],
    context: {
      vehicle: "Toyota Corolla 2018",
      battery: {
        id: "full-equipo-n40",
        name: "Full Equipo N40",
        image,
        price: 123.05,
        quantity: 1,
        total: 123.05,
      },
    },
  };
}

describe("validación del contexto de handoff", () => {
  it("conserva la imagen local del producto seleccionado", () => {
    const parsed = parseCreateHandoffInput(
      inputWithImage("/products/bateriasecuador/40.png?v=3d608e6d1845"),
    );

    expect(parsed.context.battery?.image)
      .toBe("/products/bateriasecuador/40.png?v=3d608e6d1845");
  });

  it("descarta imágenes externas", () => {
    const parsed = parseCreateHandoffInput(
      inputWithImage("https://example.com/battery.png"),
    );

    expect(parsed.context.battery?.image).toBeNull();
  });
});
