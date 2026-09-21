export const GEMINI_PCM_PROCESSOR_NAME = "gemini-pcm-processor";

export const GEMINI_PCM_PROCESSOR_SOURCE = String.raw`
class GeminiPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.captureAccumulator = 0;
    this.captureSum = 0;
    this.captureCount = 0;
    this.captureChunk = new Int16Array(1600);
    this.captureIndex = 0;
    this.playback = new Float32Array(480000);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.playbackPhase = 0;
    this.wasPlaying = false;
    this.levelFrame = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "playback" && event.data.samples instanceof ArrayBuffer) {
        this.appendPlayback(new Int16Array(event.data.samples));
      } else if (event.data?.type === "clear") {
        this.readIndex = 0;
        this.writeIndex = 0;
        this.available = 0;
        this.playbackPhase = 0;
        this.wasPlaying = false;
        this.port.postMessage({ type: "playback", active: false });
      }
    };
  }

  appendPlayback(samples) {
    for (let index = 0; index < samples.length; index += 1) {
      if (this.available === this.playback.length) {
        this.readIndex = (this.readIndex + 1) % this.playback.length;
        this.available -= 1;
      }
      this.playback[this.writeIndex] = samples[index] / 32768;
      this.writeIndex = (this.writeIndex + 1) % this.playback.length;
      this.available += 1;
    }
    if (!this.wasPlaying && this.available > 1) {
      this.wasPlaying = true;
      this.port.postMessage({ type: "playback", active: true });
    }
  }

  capture(input) {
    if (!input) return;
    for (let index = 0; index < input.length; index += 1) {
      this.captureSum += input[index];
      this.captureCount += 1;
      this.captureAccumulator += 16000;
      if (this.captureAccumulator < sampleRate) continue;
      const averaged = this.captureSum / this.captureCount;
      const clamped = Math.max(-1, Math.min(1, averaged));
      this.captureChunk[this.captureIndex] = clamped < 0
        ? Math.round(clamped * 32768)
        : Math.round(clamped * 32767);
      this.captureIndex += 1;
      this.captureAccumulator -= sampleRate;
      this.captureSum = 0;
      this.captureCount = 0;
      if (this.captureIndex === this.captureChunk.length) {
        const completed = this.captureChunk;
        this.captureChunk = new Int16Array(1600);
        this.captureIndex = 0;
        this.port.postMessage({ type: "capture", samples: completed.buffer }, [completed.buffer]);
      }
    }
  }

  render(output) {
    let energy = 0;
    const sourceStep = 24000 / sampleRate;
    for (let index = 0; index < output.length; index += 1) {
      let value = 0;
      if (this.available > 1) {
        const nextIndex = (this.readIndex + 1) % this.playback.length;
        const current = this.playback[this.readIndex];
        const next = this.playback[nextIndex];
        value = current + (next - current) * this.playbackPhase;
        this.playbackPhase += sourceStep;
        while (this.playbackPhase >= 1 && this.available > 1) {
          this.playbackPhase -= 1;
          this.readIndex = (this.readIndex + 1) % this.playback.length;
          this.available -= 1;
        }
      }
      output[index] = value;
      energy += value * value;
    }
    this.levelFrame += 1;
    if (this.levelFrame >= 8) {
      this.levelFrame = 0;
      this.port.postMessage({ type: "level", value: Math.min(1, Math.sqrt(energy / output.length) * 4) });
    }
    if (this.wasPlaying && this.available <= 1) {
      this.wasPlaying = false;
      this.port.postMessage({ type: "playback", active: false });
    }
  }

  process(inputs, outputs) {
    this.capture(inputs[0]?.[0]);
    const output = outputs[0]?.[0];
    if (output) this.render(output);
    return true;
  }
}

registerProcessor("${GEMINI_PCM_PROCESSOR_NAME}", GeminiPcmProcessor);
`;
