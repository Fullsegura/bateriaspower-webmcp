import { inputObject } from "./validation";
import type { BrowserCoordinates } from "@/lib/browser-location";

export function parseCoordinates(value: unknown): BrowserCoordinates {
  const input = inputObject(value);
  if (typeof input.latitude !== "number" || !Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90 ||
      typeof input.longitude !== "number" || !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180) {
    throw new Error("Selecciona una ubicación válida en el mapa.");
  }
  return { latitude: input.latitude, longitude: input.longitude };
}

const PUBLIC_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const ADDRESS_ERROR = "No se pudo obtener la dirección de este punto. Escríbela para continuar.";

export function createReverseGeocoder(endpoint: string, fetchImpl: typeof fetch = fetch) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("El servicio de direcciones requiere HTTPS.");
  const cache = new Map<string, { address: string; expiresAt: number }>();
  const pending = new Map<string, Promise<string>>();
  let tail = Promise.resolve();
  let nextRequestAt = 0;

  return (value: BrowserCoordinates): Promise<string> => {
    const point = parseCoordinates(value);
    const key = `${point.latitude},${point.longitude}`;
    const saved = cache.get(key);
    if (saved && saved.expiresAt > Date.now()) return Promise.resolve(saved.address);
    cache.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 8) return Promise.reject(new Error("La búsqueda de dirección está ocupada. Intenta nuevamente o escribe la dirección."));

    // Nominatim's public service permits at most one request per second per app.
    const result = tail.then(async () => {
      const delay = nextRequestAt - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      nextRequestAt = Date.now() + 1_000;
      const requestUrl = new URL(url);
      requestUrl.search = new URLSearchParams({
        format: "jsonv2", lat: String(point.latitude), lon: String(point.longitude),
        "accept-language": "es", zoom: "18", layer: "address",
      }).toString();
      try {
        const response = await fetchImpl(requestUrl, {
          headers: { accept: "application/json", "User-Agent": "PowerAuto/1.0 (https://webmcp.fullsegura.com)" },
          signal: AbortSignal.timeout(5_000), cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json() as { display_name?: unknown; error?: unknown };
          const address = payload.display_name;
          if (!payload.error && typeof address === "string" && address.trim() && address.trim().length <= 250) {
            if (cache.size >= 256) cache.delete(cache.keys().next().value!);
            cache.set(key, { address: address.trim(), expiresAt: Date.now() + 60 * 60_000 });
            return address.trim();
          }
        }
      } catch { /* No invented address or leaked provider response. */ }
      throw new Error(ADDRESS_ERROR);
    });
    tail = result.then(() => undefined, () => undefined);
    pending.set(key, result);
    void result.then(() => pending.delete(key), () => pending.delete(key));
    return result;
  };
}

const RESOLVER = Symbol.for("powerauto.delivery.reverse-geocoder");

export async function reverseGeocodeAddress(point: BrowserCoordinates): Promise<string> {
  const endpoint = process.env.NOMINATIM_REVERSE_URL?.trim() || PUBLIC_ENDPOINT;
  // Explicit opt-in is limited to the demo's single web process, not a distributed quota.
  if (process.env.NODE_ENV === "production" && new URL(endpoint).hostname === "nominatim.openstreetmap.org" &&
      process.env.NOMINATIM_PUBLIC_DEMO_ENABLED !== "true") {
    throw new Error("Configura el servicio de direcciones para producción. Puedes escribir la dirección para continuar.");
  }
  const store = globalThis as typeof globalThis & {
    [RESOLVER]?: { endpoint: string; resolve: ReturnType<typeof createReverseGeocoder> };
  };
  if (store[RESOLVER]?.endpoint !== endpoint) store[RESOLVER] = { endpoint, resolve: createReverseGeocoder(endpoint) };
  return store[RESOLVER]!.resolve(point);
}
