export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    // Ingress preserves the external Host and protocol; Next's URL uses its internal listener.
    const expected = new URL(request.url);
    const host = request.headers.get("host");
    if (host) {
      expected.port = "";
      expected.host = host;
    }
    const protocol = request.headers.get("x-forwarded-proto");
    if (protocol) {
      if (protocol !== "https" && protocol !== "http") return false;
      expected.protocol = `${protocol}:`;
    }
    return origin === expected.origin;
  } catch {
    return false;
  }
}
