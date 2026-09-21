import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fitVideoFrame,
  GeminiLiveCamera,
  VIDEO_FRAME_INTERVAL_MS,
} from "@/features/voice/gemini-live-camera";

describe("Gemini Live camera", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reduce el frame conservando su relación de aspecto", () => {
    expect(fitVideoFrame(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(fitVideoFrame(720, 1280)).toEqual({ width: 540, height: 960 });
    expect(fitVideoFrame(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("abre la cámara trasera y emite un JPEG al iniciar", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const drawImage = vi.fn();
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      readyState: 2,
      videoWidth: 1920,
      videoHeight: 1080,
      play,
      pause,
    } as unknown as HTMLVideoElement;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob([new Uint8Array([1, 2, 3])] , { type: "image/jpeg" })),
    } as unknown as HTMLCanvasElement;
    const createElement = vi.fn((tag: string) => tag === "video" ? video : canvas);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    vi.spyOn(globalThis, "setInterval").mockReturnValue(1 as never);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    const onFrame = vi.fn();
    const camera = new GeminiLiveCamera();

    await camera.start(onFrame);

    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: false,
      video: expect.objectContaining({ facingMode: { ideal: "environment" } }),
    }));
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 960, 540);
    expect(onFrame).toHaveBeenCalledWith({ data: "AQID", mimeType: "image/jpeg" });
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), VIDEO_FRAME_INTERVAL_MS);

    camera.stop();
    expect(stop).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
  });
});
