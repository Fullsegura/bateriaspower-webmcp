import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { issueLiveSessionToken } from "@/lib/live-session-token";

const SESSION_ID = "a7c9dcd8-2fe3-4d62-a893-bda9518f69ca";

describe("Live session token", () => {
  it("firma el session id y una expiración breve", () => {
    const issued = issueLiveSessionToken({
      secret: "test-secret",
      sessionId: SESSION_ID,
      now: 1_000_000,
      ttlSeconds: 300,
    });
    const [payload, signature] = issued.token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    expect(issued.sessionId).toBe(SESSION_ID);
    expect(decoded).toEqual({ sid: SESSION_ID, exp: 1_300 });
    expect(signature).toBe(
      createHmac("sha256", "test-secret").update(payload).digest("base64url"),
    );
  });

  it("rechaza un session id que no es UUID", () => {
    expect(() => issueLiveSessionToken({
      secret: "test-secret",
      sessionId: "session-user-controlled",
    })).toThrow("El identificador de sesión Live no es válido.");
  });
});
