export const VIDEO_FRAME_INTERVAL_MS = 1_000;
export const MAX_VIDEO_DIMENSION = 960;
export const MAX_VIDEO_FRAME_BYTES = 360_000;

export interface GeminiVideoFrame {
  data: string;
  mimeType: "image/jpeg";
}

export function fitVideoFrame(
  width: number,
  height: number,
  maxDimension = MAX_VIDEO_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4_096) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4_096));
  }
  return btoa(binary);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export class GeminiLiveCamera {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private capturing = false;
  private stopped = false;
  private onFrame: ((frame: GeminiVideoFrame) => void) | null = null;

  async start(onFrame: (frame: GeminiVideoFrame) => void): Promise<MediaStream> {
    if (this.stream) return this.stream;
    this.stopped = false;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      if (this.stopped) throw new DOMException("Camera start cancelled", "AbortError");
      await video.play();
      this.stream = stream;
      this.video = video;
      this.canvas = document.createElement("canvas");
      this.onFrame = onFrame;
      await this.captureFrame();
      this.interval = globalThis.setInterval(
        () => { void this.captureFrame(); },
        VIDEO_FRAME_INTERVAL_MS,
      );
      return stream;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      throw error;
    }
  }

  private async captureFrame(): Promise<void> {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas || video.readyState < 2 || this.capturing) return;
    const size = fitVideoFrame(video.videoWidth, video.videoHeight);
    if (!size.width || !size.height) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    this.capturing = true;
    try {
      canvas.width = size.width;
      canvas.height = size.height;
      context.drawImage(video, 0, 0, size.width, size.height);

      let quality = 0.82;
      let frame = await canvasToJpeg(canvas, quality);
      while (frame && frame.size > MAX_VIDEO_FRAME_BYTES && quality > 0.46) {
        quality -= 0.12;
        frame = await canvasToJpeg(canvas, quality);
      }
      if (!frame || frame.size > MAX_VIDEO_FRAME_BYTES) return;
      this.onFrame?.({
        data: bytesToBase64(await frame.arrayBuffer()),
        mimeType: "image/jpeg",
      });
    } finally {
      this.capturing = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) globalThis.clearInterval(this.interval);
    this.interval = null;
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.onFrame = null;
    this.capturing = false;
  }
}
