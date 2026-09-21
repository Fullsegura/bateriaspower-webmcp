import {
  GEMINI_PCM_PROCESSOR_NAME,
  GEMINI_PCM_PROCESSOR_SOURCE,
} from "@/features/voice/audio-worklet-processor";

export function pcmToBase64(samples: ArrayBuffer): string {
  const bytes = new Uint8Array(samples);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4_096) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4_096));
  }
  return btoa(binary);
}

export function base64ToPcm(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export class GeminiLiveAudio {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private moduleUrl: string | null = null;

  async start({
    onCapture,
    onLevel,
    onPlayback,
  }: {
    onCapture: (samples: ArrayBuffer) => void;
    onLevel: (level: number) => void;
    onPlayback: (active: boolean) => void;
  }): Promise<void> {
    if (this.context) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const context = new AudioContext({ latencyHint: "interactive" });
    const moduleUrl = URL.createObjectURL(new Blob(
      [GEMINI_PCM_PROCESSOR_SOURCE],
      { type: "text/javascript" },
    ));
    try {
      await context.audioWorklet.addModule(moduleUrl);
      const node = new AudioWorkletNode(context, GEMINI_PCM_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (event: MessageEvent<{
        type: "capture" | "level" | "playback";
        samples?: ArrayBuffer;
        value?: number;
        active?: boolean;
      }>) => {
        if (event.data.type === "capture" && event.data.samples) {
          onCapture(event.data.samples);
        } else if (event.data.type === "level") {
          onLevel(event.data.value ?? 0);
        } else if (event.data.type === "playback") {
          onPlayback(Boolean(event.data.active));
        }
      };
      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      node.connect(context.destination);
      await context.resume();
      this.context = context;
      this.node = node;
      this.source = source;
      this.stream = stream;
      this.moduleUrl = moduleUrl;
    } catch (error) {
      URL.revokeObjectURL(moduleUrl);
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      throw error;
    }
  }

  enqueuePlayback(base64Pcm: string): void {
    if (!this.node) return;
    const samples = base64ToPcm(base64Pcm);
    this.node.port.postMessage({ type: "playback", samples }, [samples]);
  }

  clearPlayback(): void {
    this.node?.port.postMessage({ type: "clear" });
  }

  async stop(): Promise<void> {
    this.clearPlayback();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed") await this.context.close();
    if (this.moduleUrl) URL.revokeObjectURL(this.moduleUrl);
    this.context = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.moduleUrl = null;
  }
}
