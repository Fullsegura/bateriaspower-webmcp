import { describe, expect, it } from "vitest";

import {
  getCatalogExecutionEpoch,
  invalidateCatalogExecutions,
  withCatalogExecution,
} from "@/features/webmcp/execution-guard";

describe("execution guard", () => {
  it("aborta una ejecución activa y la marca como obsoleta", async () => {
    let release: (() => void) | undefined;
    const pending = withCatalogExecution(async (execution) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { aborted: execution.signal.aborted, current: execution.isCurrent() };
    });

    invalidateCatalogExecutions();
    release?.();

    await expect(pending).resolves.toEqual({ aborted: true, current: false });
  });

  it("no permite que un epoch remoto reduzca el epoch local", () => {
    const before = invalidateCatalogExecutions(10_000);
    const after = invalidateCatalogExecutions(2);

    expect(before).toBeGreaterThanOrEqual(10_000);
    expect(after).toBe(before + 1);
    expect(getCatalogExecutionEpoch()).toBe(after);
  });
});
