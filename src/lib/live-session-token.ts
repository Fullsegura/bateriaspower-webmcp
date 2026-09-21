import { createHmac, randomUUID } from "node:crypto";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function issueLiveSessionToken({
  secret,
  sessionId,
  now = Date.now(),
  ttlSeconds = 300,
}: {
  secret: string;
  sessionId?: string;
  now?: number;
  ttlSeconds?: number;
}): { sessionId: string; token: string; expiresAt: string } {
  if (!secret) throw new Error("LIVE_SESSION_SECRET no está configurado.");
  const resolvedSessionId = sessionId ?? randomUUID();
  if (!SESSION_ID_PATTERN.test(resolvedSessionId)) {
    throw new Error("El identificador de sesión Live no es válido.");
  }
  const expiresAtSeconds = Math.floor(now / 1_000) + ttlSeconds;
  const payload = base64Url(JSON.stringify({ sid: resolvedSessionId, exp: expiresAtSeconds }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    sessionId: resolvedSessionId,
    token: `${payload}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
  };
}
