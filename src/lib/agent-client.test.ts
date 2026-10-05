import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialCatalogState } from "@/features/catalog/catalog-state";

import {
  normalizeInputSchema,
  serializeToolArguments,
  serializeToolFailure,
  runAgentTurn,
} from "@/lib/agent-client";

afterEach(() => vi.unstubAllGlobals());

describe("cliente del agente", () => {
  it("envía el evento al agente y conserva su respuesta después de verificar el pago", async () => {
    const event = { type: "payment_status_changed" as const, transactionId: "payment-test" };
    const messages = [{ id: "user", role: "user" as const, content: "Cotiza una." }];
    const verified = { id: "payment-test", status: "VALIDATED" };
    const tool = { name: "get_payment_status", title: "Estado", description: "Consultar estado" };
    const executeTool = vi.fn().mockResolvedValue(verified);
    vi.stubGlobal("document", { modelContext: { getTools: () => [tool], executeTool } });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ kind: "tool_call", toolName: tool.name, arguments: { transactionId: event.transactionId } }))
      .mockResolvedValueOnce(Response.json({ kind: "message", message: "El agente confirmó el pago." }));
    vi.stubGlobal("fetch", fetch);
    const result = await runAgentTurn({ sessionId: "session", messages, getUiState: createInitialCatalogState, event });
    expect(result).toBe("El agente confirmó el pago.");
    expect(executeTool).toHaveBeenCalledWith(tool, JSON.stringify({ transactionId: event.transactionId }), { signal: undefined });
    const requests = fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.event).toEqual(event);
      expect(request.messages).toEqual(messages);
    }
    expect(requests[1].toolResult).toEqual({ toolName: tool.name, result: verified });
  });

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
