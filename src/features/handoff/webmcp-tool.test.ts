import { describe, expect, it, vi } from "vitest";

import {
  bindAdvisorHandoffAction,
  requestAdvisorHandoffTool,
} from "@/features/handoff/webmcp-tool";

describe("tool WebMCP de handoff", () => {
  it("ejecuta la misma acción de handoff enlazada por la interfaz", async () => {
    const action = vi.fn(async () => ({
      ok: true,
      handoffId: "handoff-1",
      status: "waiting",
    }));
    const unbind = bindAdvisorHandoffAction(action);

    await expect(requestAdvisorHandoffTool.execute({})).resolves.toEqual({
      ok: true,
      handoffId: "handoff-1",
      status: "waiting",
    });
    expect(action).toHaveBeenCalledOnce();
    unbind();
  });

  it("informa cuando la interfaz no ha enlazado el handoff", async () => {
    await expect(requestAdvisorHandoffTool.execute({})).resolves.toEqual({
      ok: false,
      error: "El handoff todavía no está disponible.",
    });
  });
});
