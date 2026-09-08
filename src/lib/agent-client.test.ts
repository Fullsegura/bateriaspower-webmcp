import { describe, expect, it } from "vitest";

import {
  normalizeInputSchema,
  serializeToolArguments,
  serializeToolFailure,
} from "@/lib/agent-client";

describe("cliente del agente", () => {
  it("convierte el inputSchema serializado por Chrome en un objeto", () => {
    expect(
      normalizeInputSchema(
        '{"type":"object","properties":{"tireId":{"type":"string"}}}',
      ),
    ).toEqual({
      type: "object",
      properties: { tireId: { type: "string" } },
    });
  });

  it("conserva un inputSchema que ya es un objeto", () => {
    const schema = { type: "object", properties: {} };

    expect(normalizeInputSchema(schema)).toBe(schema);
  });

  it("rechaza un inputSchema serializado inválido", () => {
    expect(() => normalizeInputSchema("[]")).toThrow(
      "WebMCP devolvió un inputSchema no válido.",
    );
  });

  it("serializa los argumentos antes de ejecutar una herramienta en Chrome", () => {
    expect(serializeToolArguments({ mode: "measure", width: "225", height: "65", rim: "17" }))
      .toBe('{"mode":"measure","width":"225","height":"65","rim":"17"}');
  });

  it("convierte un fallo de herramienta en un resultado que el agente puede explicar", () => {
    expect(serializeToolFailure(new Error("El modelo es ambiguo. Opciones: A, B.")))
      .toEqual({ ok: false, error: "El modelo es ambiguo. Opciones: A, B." });
  });
});
