import { describe, expect, it } from "vitest";

import { isClientHandoffVisible } from "@/features/handoff/handoff-view-state";

describe("visibilidad del handoff cliente", () => {
  it("oculta el chat del asesor al finalizar", () => {
    expect(isClientHandoffVisible("waiting")).toBe(true);
    expect(isClientHandoffVisible("accepted")).toBe(true);
    expect(isClientHandoffVisible("connected")).toBe(true);
    expect(isClientHandoffVisible("ended")).toBe(false);
    expect(isClientHandoffVisible(null)).toBe(false);
  });
});
