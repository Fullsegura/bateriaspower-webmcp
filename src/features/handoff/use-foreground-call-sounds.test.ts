import { describe, expect, it } from "vitest";

import {
  didCallEnd,
  hasWaitingAdvisorCall,
  shouldRingClient,
} from "@/features/handoff/use-foreground-call-sounds";
import type { PublicHandoffCase } from "@/features/handoff/types";

function handoff(status: PublicHandoffCase["status"]): PublicHandoffCase {
  return { status } as PublicHandoffCase;
}

describe("sonidos foreground del handoff", () => {
  it("mantiene el timbrado del cliente hasta que aparece el asesor", () => {
    expect(shouldRingClient("waiting", 0)).toBe(true);
    expect(shouldRingClient("accepted", 0)).toBe(true);
    expect(shouldRingClient("connected", 1)).toBe(false);
    expect(shouldRingClient("ended", 0)).toBe(false);
  });

  it("activa el timbrado del asesor solo con casos nuevos en espera", () => {
    expect(hasWaitingAdvisorCall([handoff("accepted")])).toBe(false);
    expect(hasWaitingAdvisorCall([handoff("accepted"), handoff("waiting")])).toBe(true);
  });

  it("detecta una sola transición de colgado", () => {
    expect(didCallEnd("connected", "ended")).toBe(true);
    expect(didCallEnd("waiting", "ended")).toBe(true);
    expect(didCallEnd("ended", "ended")).toBe(false);
    expect(didCallEnd(null, "ended")).toBe(false);
  });
});
