import { afterEach, describe, expect, it, vi } from "vitest";
import { currentBrowserCoordinates } from "@/lib/browser-location";

describe("ubicación del navegador", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("devuelve únicamente las coordenadas obtenidas del navegador", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: { latitude: -0.18065, longitude: -78.46783 },
    } as GeolocationPosition));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    await expect(currentBrowserCoordinates()).resolves.toEqual({ latitude: -0.18065, longitude: -78.46783 });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it.each([
    [1, "bloqueado"], [2, "no pudo determinar"], [3, "tardó demasiado"], [0, "No se pudo obtener"],
  ])("distingue el error técnico %i sin inventar coordenadas", async (code, text) => {
    vi.stubGlobal("navigator", { geolocation: {
      getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({ code } as GeolocationPositionError),
    } });
    await expect(currentBrowserCoordinates()).rejects.toThrow(text);
    if (code !== 1) await expect(currentBrowserCoordinates()).rejects.not.toThrow("permiso");
  });

  it("informa cuando el navegador no ofrece geolocalización", async () => {
    vi.stubGlobal("navigator", {});
    await expect(currentBrowserCoordinates()).rejects.toThrow("no está disponible");
  });
});
