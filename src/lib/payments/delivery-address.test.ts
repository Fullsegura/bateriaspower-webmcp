import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogSession } from "@/lib/catalog-session";
import { POST } from "@/app/api/payments/maps/address/route";
import { createReverseGeocoder, parseCoordinates, reverseGeocodeAddress } from "./delivery-address";

const endpoint = "https://nominatim.openstreetmap.org/reverse";
const point = { latitude: -0.15, longitude: -78.46 };
const provider = (data: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(Response.json(data, { status }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Nominatim delivery address", () => {
  it("returns the provider address and sends coordinates only, with identification", async () => {
    const fetchImpl = provider({ display_name: " Julio Arellano, Quito " });
    expect(await createReverseGeocoder(endpoint, fetchImpl)(point)).toBe("Julio Arellano, Quito");
    const [url, options] = fetchImpl.mock.calls[0];
    const params = new URL(String(url)).searchParams;
    expect(params.get("lat")).toBe("-0.15");
    expect(params.get("lon")).toBe("-78.46");
    expect(params.get("accept-language")).toBe("es");
    expect(params.has("key")).toBe(false);
    expect(new Headers(options?.headers).get("user-agent")).toContain("PowerAuto");
  });
  it.each([{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }, { latitude: "0", longitude: 0 }, null])("rejects invalid coordinates %j", (invalid) => {
    expect(() => parseCoordinates(invalid)).toThrow();
  });
  it("caches repeated coordinates and shares concurrent requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ display_name: "Dirección del punto" }));
    const resolve = createReverseGeocoder(endpoint, fetchImpl);
    expect(await Promise.all([resolve(point), resolve(point)])).toEqual(["Dirección del punto", "Dirección del punto"]);
    expect(await resolve(point)).toBe("Dirección del punto");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("spaces all provider requests by at least one second", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      starts.push(Date.now()); return Response.json({ display_name: "Dirección del punto" });
    });
    const resolve = createReverseGeocoder(endpoint, fetchImpl);
    const first = resolve(point);
    const second = resolve({ ...point, latitude: -0.16 });
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });
  it("limits the pending queue instead of flooding the public service", async () => {
    const resolve = createReverseGeocoder(endpoint, vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})));
    for (let i = 0; i < 8; i++) void resolve({ latitude: i, longitude: 0 });
    await expect(resolve({ latitude: 9, longitude: 0 })).rejects.toThrow("ocupada");
  });
  it.each([{ error: "Unable to geocode" }, { display_name: 42 }, { display_name: "a".repeat(251) }])("does not invent or truncate an address %j", async (data) => {
    await expect(createReverseGeocoder(endpoint, provider(data))(point)).rejects.toThrow("Escríbela para continuar");
  });
  it("allows manual recovery after HTTP or network failure", async () => {
    await expect(createReverseGeocoder(endpoint, provider({}, 503))(point)).rejects.toThrow("Escríbela");
    await expect(createReverseGeocoder(endpoint, vi.fn().mockRejectedValue(new Error("provider details")))(point)).rejects.toThrow("Escríbela");
  });
  it("does not use a process-local public quota in multi-instance production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NOMINATIM_REVERSE_URL", "");
    await expect(reverseGeocodeAddress(point)).rejects.toThrow("producción");
  });
  it("requires a session and same-origin requests before querying Nominatim", async () => {
    const fetchImpl = provider({});
    vi.stubGlobal("fetch", fetchImpl);
    const session = createCatalogSession();
    const request = (headers: Record<string, string>, body: unknown = point) => new Request("http://localhost:3000/api/payments/maps/address", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    expect((await POST(request({}))).status).toBe(403);
    expect((await POST(request({ "x-catalog-session": session, origin: "https://other.example" }))).status).toBe(403);
    expect((await POST(request({ "x-catalog-session": session }, { latitude: 100, longitude: 0 }))).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("returns the verified address to the current session", async () => {
    vi.stubEnv("NOMINATIM_REVERSE_URL", "https://geocoder.example.test/reverse");
    vi.stubGlobal("fetch", provider({ display_name: "Dirección verificada" }));
    const response = await POST(new Request("http://localhost:3000/api/payments/maps/address", {
      method: "POST", headers: { "content-type": "application/json", "x-catalog-session": createCatalogSession() }, body: JSON.stringify(point),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ address: "Dirección verificada" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
