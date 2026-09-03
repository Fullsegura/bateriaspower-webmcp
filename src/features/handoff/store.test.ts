import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptHandoffCase,
  createHandoffCase,
  endHandoffCaseByClient,
  getHandoffCaseForClient,
  handoffStoreConfig,
  heartbeatHandoffCase,
  listHandoffCases,
  resetHandoffStoreForTests,
} from "@/features/handoff/store";

const input = {
  customerName: "Ana",
  transcript: [{ id: "1", role: "user" as const, content: "Necesito ayuda" }],
  context: {
    vehicle: "Toyota Corolla 2018",
    battery: {
      id: "full-equipo-n40",
      name: "Full Equipo N40",
      image: "/products/bateriasecuador/40.png?v=3d608e6d1845",
      price: 123.05,
      quantity: 1,
      total: 123.05,
    },
  },
};

describe("handoff store autónomo", () => {
  beforeEach(() => {
    resetHandoffStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T20:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("crea un caso aislado con secreto y contexto", () => {
    const created = createHandoffCase(input);

    expect(created.handoff.status).toBe("waiting");
    expect(created.handoff.context.vehicle).toBe("Toyota Corolla 2018");
    expect(created.handoff.context.battery?.image)
      .toBe("/products/bateriasecuador/40.png?v=3d608e6d1845");
    expect(created.clientSecret).not.toContain(created.handoff.id);
    expect(getHandoffCaseForClient(created.handoff.id, created.clientSecret))
      .toEqual(created.handoff);
    expect(() => getHandoffCaseForClient(created.handoff.id, "incorrecto"))
      .toThrow("Credencial de cliente inválida.");
  });

  it("acepta una sola vez y conserva el caso", () => {
    const created = createHandoffCase(input);

    expect(acceptHandoffCase(created.handoff.id, "Beatriz").status)
      .toBe("accepted");
    expect(() => acceptHandoffCase(created.handoff.id, "Otra asesora"))
      .toThrow("El caso ya no está disponible.");
    expect(listHandoffCases()).toHaveLength(1);
  });

  it("expira por pérdida de heartbeat y permite cierre idempotente", () => {
    const created = createHandoffCase(input);
    heartbeatHandoffCase(created.handoff.id, created.clientSecret);

    vi.advanceTimersByTime(handoffStoreConfig.clientLeaseMs + 1);
    expect(listHandoffCases()[0]).toMatchObject({
      status: "ended",
      endedBy: "timeout",
    });

    expect(endHandoffCaseByClient(created.handoff.id, created.clientSecret))
      .toMatchObject({ status: "ended", endedBy: "timeout" });
  });
});
