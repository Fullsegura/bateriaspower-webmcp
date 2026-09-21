import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
