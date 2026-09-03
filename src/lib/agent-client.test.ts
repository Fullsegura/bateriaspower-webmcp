import { describe, expect, it } from "vitest";

import {
  normalizeInputSchema,
  serializeToolArguments,
} from "@/lib/agent-client";

describe("cliente del agente", () => {
  it("convierte el inputSchema serializado por Chrome en un objeto", () => {
    expect(
      normalizeInputSchema(
        '{"type":"object","properties":{"batteryId":{"type":"string"}}}',
      ),
    ).toEqual({
      type: "object",
      properties: { batteryId: { type: "string" } },
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
    expect(serializeToolArguments({ make: "Ford", model: "F-150", year: 2014 }))
      .toBe('{"make":"Ford","model":"F-150","year":2014}');
  });
});
