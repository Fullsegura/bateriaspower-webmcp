import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

import { GEMINI_PCM_PROCESSOR_SOURCE } from "@/features/voice/audio-worklet-processor";
import { base64ToPcm, pcmToBase64 } from "@/features/voice/gemini-live-audio";

describe("Gemini Live PCM", () => {
  beforeEach(() => {
    vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("conserva exactamente los bytes PCM en base64", () => {
    const source = new Int16Array([-32768, -1, 0, 1, 32767]);
    const restored = new Int16Array(base64ToPcm(pcmToBase64(source.buffer)));

    expect([...restored]).toEqual([...source]);
  });

  it("declara explícitamente captura 16 kHz y reproducción 24 kHz", () => {
    expect(GEMINI_PCM_PROCESSOR_SOURCE).toContain("this.captureAccumulator += 16000");
    expect(GEMINI_PCM_PROCESSOR_SOURCE).toContain("const sourceStep = 24000 / sampleRate");
  });

  it("marca presentación al renderizar el bloque correcto y descarta marcas al interrumpir", () => {
    const messages: Array<{ type: string; marker?: string }> = [];
    let createProcessor: () => {
      port: { onmessage: (event: unknown) => void };
      render: (output: Float32Array) => void;
    };
    runInNewContext(GEMINI_PCM_PROCESSOR_SOURCE, {
      AudioWorkletProcessor: class { port = { postMessage: (message: typeof messages[number]) => messages.push(message) }; },
      registerProcessor: (_name: string, Constructor: new () => ReturnType<typeof createProcessor>) => {
        createProcessor = () => new Constructor();
      },
      sampleRate: 24000, ArrayBuffer, Int16Array, Float32Array,
    });
    const processor = createProcessor!();
    const append = (marker?: string) => processor.port.onmessage({
      data: { type: "playback", samples: new Int16Array([100, 200, 300, 400]).buffer, marker },
    });
    append();
    append("second-chunk");
    expect(messages.filter((m) => m.type === "presentation")).toEqual([]);
    processor.render(new Float32Array(4));
    expect(messages.filter((m) => m.type === "presentation")).toEqual([]);
    processor.render(new Float32Array(2));
    expect(messages.filter((m) => m.type === "presentation")).toEqual([{ type: "presentation", marker: "second-chunk" }]);
    append("cancelled");
    processor.port.onmessage({ data: { type: "clear" } });
    append("new-turn");
    processor.render(new Float32Array(2));
    expect(messages.filter((m) => m.type === "presentation").map((m) => m.marker)).toEqual(["second-chunk", "new-turn"]);
  });
});
