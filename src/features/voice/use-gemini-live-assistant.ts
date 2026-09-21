"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  invalidateCatalogExecutions,
} from "@/features/webmcp/execution-guard";
import {
  GeminiLiveAudio,
  pcmToBase64,
} from "@/features/voice/gemini-live-audio";
import {
  GeminiLiveCamera,
  type GeminiVideoFrame,
} from "@/features/voice/gemini-live-camera";
import {
  normalizeInputSchema,
  serializeToolArguments,
  serializeToolFailure,
} from "@/lib/agent-client";

export type VoiceAssistantStatus =
  | "disconnected"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

interface SessionCredentials {
  sessionId: string;
  token: string;
}

interface ToolCallMessage {
  type: "tool_call";
  call_id: string;
  epoch: number;
  name: string;
  args: Record<string, unknown>;
}

function websocketUrl(sessionId: string, token: string): string {
  const configured = process.env.NEXT_PUBLIC_LIVE_WS_URL?.replace(/\/$/, "");
  if (configured) {
    return `${configured}/ws/live/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;
  }
  const { protocol, hostname, host } = window.location;
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const authority = local ? `${hostname}:8000` : host;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${authority}/ws/live/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;
}

async function issueSession(sessionId?: string): Promise<SessionCredentials> {
  const response = await fetch("/api/live/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionId ? { sessionId } : {}),
    cache: "no-store",
  });
  const payload = await response.json() as SessionCredentials & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || "No se pudo iniciar la sesión de voz.");
  return payload;
}

function abortExecutions(executions: Map<string, AbortController>, epoch: number): void {
  for (const controller of executions.values()) controller.abort();
  executions.clear();
  invalidateCatalogExecutions(epoch);
}

export function useGeminiLiveAssistant({
  enabled,
  onTranscript,
}: {
  enabled: boolean;
  onTranscript?: (role: "user" | "assistant", text: string, final: boolean) => void;
}) {
  const [status, setStatus] = useState<VoiceAssistantStatus>("disconnected");
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<GeminiLiveAudio | null>(null);
  const cameraRef = useRef<GeminiLiveCamera | null>(null);
  const activeRef = useRef(false);
  const stoppingRef = useRef(false);
  const readyRef = useRef(false);
  const epochRef = useRef(0);
  const interactionRef = useRef<"IN_PROGRESS" | "IDLE">("IDLE");
  const executionsRef = useRef(new Map<string, AbortController>());
  const sessionIdRef = useRef<string | null>(null);
  const resumptionHandleRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef(onTranscript);

  useEffect(() => {
    transcriptRef.current = onTranscript;
  }, [onTranscript]);

  const sendAudio = useCallback((samples: ArrayBuffer) => {
    const socket = socketRef.current;
    if (!readyRef.current || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "audio", data: pcmToBase64(samples) }));
  }, []);

  const sendVideo = useCallback((frame: GeminiVideoFrame) => {
    const socket = socketRef.current;
    if (!readyRef.current || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: "video",
      data: frame.data,
      mime_type: frame.mimeType,
    }));
  }, []);

  const executeBrowserTool = useCallback(async (message: ToolCallMessage) => {
    if (message.epoch !== epochRef.current || !activeRef.current) return;
    const modelContext = document.modelContext;
    const controller = new AbortController();
    executionsRef.current.set(message.call_id, controller);
    try {
      if (!modelContext) throw new Error("WebMCP dejó de estar disponible.");
      const tools = await modelContext.getTools();
      if (controller.signal.aborted) return;
      const tool = tools.find(({ name }) => name === message.name);
      if (!tool) throw new Error(`La herramienta WebMCP '${message.name}' no está disponible.`);
      const result = await modelContext.executeTool(
        tool,
        serializeToolArguments(message.args),
        { signal: controller.signal },
      );
      const socket = socketRef.current;
      if (
        controller.signal.aborted
        || message.epoch !== epochRef.current
        || socket?.readyState !== WebSocket.OPEN
      ) return;
      socket.send(JSON.stringify({
        type: "tool_response",
        call_id: message.call_id,
        epoch: message.epoch,
        result,
      }));
    } catch (caught) {
      const socket = socketRef.current;
      if (
        controller.signal.aborted
        || message.epoch !== epochRef.current
        || socket?.readyState !== WebSocket.OPEN
      ) return;
      socket.send(JSON.stringify({
        type: "tool_response",
        call_id: message.call_id,
        epoch: message.epoch,
        result: serializeToolFailure(caught),
      }));
    } finally {
      executionsRef.current.delete(message.call_id);
    }
  }, []);

  const connectRef = useRef<() => Promise<void>>(async () => undefined);

  const connect = useCallback(async () => {
    const modelContext = document.modelContext;
    if (!modelContext) throw new Error("Este navegador no ofrece WebMCP nativo.");
    const credentials = await issueSession(sessionIdRef.current ?? undefined);
    sessionIdRef.current = credentials.sessionId;
    const registeredTools = await modelContext.getTools();
    const tools = registeredTools.map(
      ({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema: normalizeInputSchema(inputSchema),
        annotations,
      }),
    );
    const socket = new WebSocket(websocketUrl(credentials.sessionId, credentials.token));
    socketRef.current = socket;
    readyRef.current = false;
    setStatus("connecting");

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "init",
        tools,
        resumption_handle: resumptionHandleRef.current,
      }));
    };
    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === "ready" && typeof message.epoch === "number") {
        epochRef.current = message.epoch;
        readyRef.current = true;
        reconnectAttemptsRef.current = 0;
        setError(null);
        setStatus("listening");
      } else if (message.type === "audio" && typeof message.data === "string") {
        audioRef.current?.enqueuePlayback(message.data);
        setStatus("speaking");
      } else if (message.type === "state" && (
        message.state === "IN_PROGRESS" || message.state === "IDLE"
      )) {
        interactionRef.current = message.state;
        setStatus(message.state === "IN_PROGRESS" ? "thinking" : "listening");
      } else if (message.type === "interrupted" && typeof message.epoch === "number") {
        epochRef.current = message.epoch;
        abortExecutions(executionsRef.current, message.epoch);
        audioRef.current?.clearPlayback();
        setStatus("listening");
      } else if (message.type === "tool_call") {
        const candidate = message as unknown as ToolCallMessage;
        if (
          typeof candidate.call_id === "string"
          && typeof candidate.epoch === "number"
          && typeof candidate.name === "string"
          && candidate.args !== null
          && typeof candidate.args === "object"
        ) {
          void executeBrowserTool(candidate);
        }
      } else if (
        message.type === "transcript"
        && (message.role === "user" || message.role === "assistant")
        && typeof message.text === "string"
        && message.text.trim()
      ) {
        transcriptRef.current?.(message.role, message.text, message.final === true);
      } else if (message.type === "session_resumption") {
        resumptionHandleRef.current = message.resumable === true && typeof message.handle === "string"
          ? message.handle
          : null;
      } else if (message.type === "error" && typeof message.message === "string") {
        setError(message.message);
        setStatus("error");
      }
    };
    socket.onerror = () => {
      if (activeRef.current) setStatus("connecting");
    };
    socket.onclose = () => {
      readyRef.current = false;
      if (!activeRef.current || stoppingRef.current) return;
      epochRef.current += 1;
      abortExecutions(executionsRef.current, epochRef.current);
      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current > 5) {
        abortExecutions(executionsRef.current, epochRef.current + 1);
        setError("No fue posible restablecer la sesión de voz.");
        setStatus("error");
        activeRef.current = false;
        const audio = audioRef.current;
        audioRef.current = null;
        cameraRef.current?.stop();
        cameraRef.current = null;
        setCameraStream(null);
        setCameraActive(false);
        void audio?.stop();
        return;
      }
      const delay = Math.min(5_000, 500 * 2 ** (reconnectAttemptsRef.current - 1));
      reconnectTimerRef.current = setTimeout(() => {
        void connectRef.current().catch((caught) => {
          setError(caught instanceof Error ? caught.message : "No se pudo reconectar.");
          setStatus("error");
        });
      }, delay);
    };
  }, [executeBrowserTool]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    setCameraStream(null);
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  const stop = useCallback(async () => {
    stoppingRef.current = true;
    activeRef.current = false;
    readyRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    abortExecutions(executionsRef.current, epochRef.current + 1);
    epochRef.current += 1;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "audio_stream_end" }));
      socket.send(JSON.stringify({ type: "close" }));
    }
    socket?.close();
    socketRef.current = null;
    stopCamera();
    await audioRef.current?.stop();
    audioRef.current = null;
    setVolume(0);
    setStatus("disconnected");
    stoppingRef.current = false;
  }, [stopCamera]);

  const start = useCallback(async () => {
    if (!enabled || activeRef.current) return;
    setError(null);
    setStatus("connecting");
    activeRef.current = true;
    stoppingRef.current = false;
    const audio = new GeminiLiveAudio();
    audioRef.current = audio;
    try {
      await audio.start({
        onCapture: sendAudio,
        onLevel: setVolume,
        onPlayback: (playing) => {
          if (playing) {
            setStatus("speaking");
          } else if (activeRef.current) {
            setStatus(interactionRef.current === "IN_PROGRESS" ? "thinking" : "listening");
          }
        },
      });
      await connect();
    } catch (caught) {
      activeRef.current = false;
      await audio.stop();
      audioRef.current = null;
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar la voz.");
      setStatus("error");
    }
  }, [connect, enabled, sendAudio]);

  const startCamera = useCallback(async () => {
    if (!enabled || cameraRef.current || cameraStarting) return;
    setError(null);
    setCameraStarting(true);
    if (!activeRef.current) await start();
    if (!activeRef.current) {
      setCameraStarting(false);
      return;
    }
    const camera = new GeminiLiveCamera();
    cameraRef.current = camera;
    try {
      const stream = await camera.start(sendVideo);
      if (cameraRef.current !== camera) {
        camera.stop();
        return;
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", stopCamera, { once: true });
      setCameraStream(stream);
      setCameraActive(true);
    } catch (caught) {
      camera.stop();
      if (cameraRef.current === camera) {
        cameraRef.current = null;
        setError(caught instanceof Error ? caught.message : "No se pudo abrir la cámara.");
      }
    } finally {
      setCameraStarting(false);
    }
  }, [cameraStarting, enabled, sendVideo, start, stopCamera]);

  useEffect(() => () => {
    activeRef.current = false;
    readyRef.current = false;
    socketRef.current?.close();
    abortExecutions(executionsRef.current, epochRef.current + 1);
    void audioRef.current?.stop();
    cameraRef.current?.stop();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  }, []);

  return useMemo(() => ({
    active: status !== "disconnected" && status !== "error",
    cameraActive,
    cameraStarting,
    cameraStream,
    error,
    start,
    startCamera,
    status,
    stop,
    stopCamera,
    volume,
  }), [cameraActive, cameraStarting, cameraStream, error, start, startCamera, status, stop, stopCamera, volume]);
}
