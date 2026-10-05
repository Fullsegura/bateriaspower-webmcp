import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./request-origin";

describe("payment origin behind ingress", () => {
  const publicHost = "webmcp.fullsegura.com";
  const proxied = (origin: string, extra: Record<string, string> = {}) => new Request(
    "http://0.0.0.0:3000/api/payments/quote",
    { headers: { host: publicHost, "x-forwarded-proto": "https", origin, ...extra } },
  );
  it("accepts the external HTTPS origin with an internal Next listener", () => {
    expect(isSameOriginRequest(proxied(`https://${publicHost}`))).toBe(true);
  });
  it.each(["https://other.example", "http://webmcp.fullsegura.com", "null", "invalid"])(
    "rejects a foreign or invalid origin: %s", (origin) => {
      expect(isSameOriginRequest(proxied(origin))).toBe(false);
    },
  );
  it("does not trust a client-supplied forwarded host", () => {
    expect(isSameOriginRequest(proxied("https://other.example", { "x-forwarded-host": "other.example" }))).toBe(false);
  });
  it("rejects ambiguous forwarded protocols", () => {
    expect(isSameOriginRequest(proxied(`https://${publicHost}`, { "x-forwarded-proto": "https,http" }))).toBe(false);
  });
  it("preserves local direct requests", () => {
    expect(isSameOriginRequest(new Request("http://localhost:3000/test", { headers: { origin: "http://localhost:3000" } }))).toBe(true);
  });
  it("preserves an explicit external port instead of the internal listener port", () => {
    expect(isSameOriginRequest(proxied("https://webmcp.fullsegura.com:8443", { host: "webmcp.fullsegura.com:8443" }))).toBe(true);
    expect(isSameOriginRequest(proxied("https://webmcp.fullsegura.com:3000"))).toBe(false);
  });
  it("preserves requests without an Origin header", () => {
    expect(isSameOriginRequest(new Request("http://localhost:3000/test"))).toBe(true);
  });
});
