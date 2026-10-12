import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

describe("Origin Trial response header", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured token without exposing it in page markup", () => {
    vi.stubEnv("ORIGIN_TRIAL", "trial-token");

    const response = proxy();

    expect(response.headers.get("Origin-Trial")).toBe("trial-token");
  });

  it("omits the header when the token is not configured", () => {
    vi.stubEnv("ORIGIN_TRIAL", "");

    const response = proxy();

    expect(response.headers.has("Origin-Trial")).toBe(false);
  });
});
