"use client";

import { Mic, MicOff, Phone, PhoneOff, Send, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  HandoffTireContext,
  LiveKitConnection,
  PublicHandoffCase,
} from "@/features/handoff/types";
import { isClientHandoffVisible } from "@/features/handoff/handoff-view-state";
import {
  shouldRingClient,
  useForegroundCallSounds,
} from "@/features/handoff/use-foreground-call-sounds";
import { useLiveKitAudio } from "@/features/handoff/use-livekit-audio";
import type { ChatMessage } from "@/types/agent";

interface Props {
  messages: ChatMessage[];
  vehicle: string | null;
  tire: HandoffTireContext | null;
  onActiveChange: (active: boolean) => void;
}

interface Session {
  handoff: PublicHandoffCase;
  clientSecret: string;
  connection: LiveKitConnection;
}

async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.detail || "No fue posible iniciar el handoff.");
  }
  return body;
}

export function ClientHandoffPanel({
  messages,
  vehicle,
  tire,
  onActiveChange,
}: Props) {
  const [customerName, setCustomerName] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [handoff, setHandoff] = useState<PublicHandoffCase | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const liveMessagesRef = useRef<HTMLDivElement>(null);
  const finishingRef = useRef(false);
  const { playHangup, startRinging, stopRinging, unlock } = useForegroundCallSounds();
  const {
    audioRootRef,
    connect: connectAudio,
    disconnect: disconnectAudio,
    error: audioError,
    muted,
    remoteParticipantCount,
    sendText: sendLiveText,
    textMessages,
    toggleMute,
  } = useLiveKitAudio();

  const handoffStatus = handoff?.status;
  const active = isClientHandoffVisible(handoffStatus);
  useEffect(() => onActiveChange(active), [active, onActiveChange]);

  useEffect(() => {
    if (shouldRingClient(handoffStatus, remoteParticipantCount)) startRinging();
    else stopRinging();
  }, [handoffStatus, remoteParticipantCount, startRinging, stopRinging]);

  useEffect(() => {
    const container = liveMessagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [textMessages]);

  const finishHandoff = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    stopRinging();
    playHangup();
    await disconnectAudio().catch(() => undefined);
    setSession(null);
    setHandoff(null);
    setChatDraft("");
    setChatError(null);
    setRequestError(null);
  }, [disconnectAudio, playHangup, stopRinging]);

  const postAction = useCallback(async (action: "status" | "heartbeat" | "end") => {
    if (!session) return null;
    const response = await fetch("/api/handoff/cases/" + session.handoff.id, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, clientSecret: session.clientSecret }),
    });
    const body = await readJson(response);
    const next = body.handoff as PublicHandoffCase;
    if (next.status !== "ended") setHandoff(next);
    return next;
  }, [session]);

  useEffect(() => {
    if (!handoffStatus || handoffStatus === "ended") return;

    const statusTimer = window.setInterval(() => {
      void postAction("status").then((next) => {
        if (next?.status === "ended") void finishHandoff();
      }).catch((error) => {
        setRequestError(error instanceof Error ? error.message : "No se pudo actualizar el caso.");
      });
    }, 2_000);
    const heartbeatTimer = window.setInterval(() => {
      void postAction("heartbeat").catch(() => undefined);
    }, 10_000);

    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(heartbeatTimer);
    };
  }, [finishHandoff, handoffStatus, postAction]);

  const statusText = useMemo(() => {
    if (requesting) return "Preparando sala segura…";
    if (!handoff) return null;
    if (remoteParticipantCount > 0) return "Conectado con el asesor";
    if (handoff.status === "waiting") return "Esperando a un asesor";
    if (handoff.status === "accepted") return "El asesor está ingresando";
    if (handoff.status === "connected") return "Conectado con el asesor";
    return "Llamada finalizada";
  }, [handoff, remoteParticipantCount, requesting]);

  async function start() {
    finishingRef.current = false;
    setChatDraft("");
    setChatError(null);
    unlock();
    setRequesting(true);
    setRequestError(null);
    let created: Session | null = null;
    try {
      const response = await fetch("/api/handoff/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName,
          transcript: messages,
          context: { vehicle, tire },
        }),
      });
      created = await readJson(response) as Session;
      setSession(created);
      setHandoff(created.handoff);
      await connectAudio(created.connection);
    } catch (error) {
      if (created) {
        await fetch("/api/handoff/cases/" + created.handoff.id, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "end",
            clientSecret: created.clientSecret,
          }),
        }).catch(() => undefined);
      }
      setSession(null);
      setHandoff(null);
      await disconnectAudio().catch(() => undefined);
      setRequestError(error instanceof Error ? error.message : "No fue posible iniciar la llamada.");
    } finally {
      setRequesting(false);
    }
  }

  async function end() {
    try {
      await postAction("end");
    } finally {
      await finishHandoff();
    }
  }

  async function submitLiveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = chatDraft.trim();
    if (!content || remoteParticipantCount === 0 || handoffStatus === "ended") return;
    setChatError(null);
    try {
      await sendLiveText(content);
      setChatDraft("");
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : "No se pudo enviar el mensaje.");
    }
  }

  if (!handoff || !active) {
    return (
      <section className="handoffClient" aria-label="Hablar con un asesor">
        <div className="handoffClientIntro">
          <span><UserRound size={16} /></span>
          <div>
            <strong>¿Prefieres hablar?</strong>
            <small>Transfiere este chat y tu selección a un asesor.</small>
          </div>
        </div>
        <div className="handoffClientActions">
          <input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Tu nombre (opcional)"
            aria-label="Tu nombre"
            maxLength={80}
          />
          <button type="button" onClick={() => void start()} disabled={requesting}>
            <Phone size={16} />
            {requesting ? "Conectando…" : "Hablar con asesor"}
          </button>
        </div>
        {requestError ? <p role="alert">{requestError}</p> : null}
        <div ref={audioRootRef} hidden />
      </section>
    );
  }

  return (
    <section className="handoffClient handoffClientActive" aria-live="polite">
      <div>
        <strong>{statusText}</strong>
        <small>
          {remoteParticipantCount > 0
            ? "Audio bidireccional activo"
            : "Sala de voz preparada"}
        </small>
      </div>
      <div className="handoffCallActions">
        <button type="button" onClick={() => void toggleMute()}>
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
          {muted ? "Activar" : "Silenciar"}
        </button>
        <button type="button" className="danger" onClick={() => void end()}>
          <PhoneOff size={16} /> Colgar
        </button>
      </div>
      <div className="handoffClientLiveChat">
        <div ref={liveMessagesRef} className="handoffClientMessages" aria-live="polite">
          {textMessages.map((message) => (
            <p key={message.id} data-direction={message.direction}>
              <span>{message.direction === "local" ? "Tú" : "Asesor"}</span>
              {message.content}
            </p>
          ))}
          {!textMessages.length ? (
            <small>
              {remoteParticipantCount > 0
                ? "También puedes escribir al asesor."
                : "El chat se habilita cuando ingrese el asesor."}
            </small>
          ) : null}
        </div>
        <form className="handoffClientComposer" onSubmit={submitLiveText}>
          <input
            value={chatDraft}
            onChange={(event) => setChatDraft(event.target.value)}
            placeholder={remoteParticipantCount > 0 ? "Escribe al asesor…" : "Esperando al asesor…"}
            aria-label="Mensaje para el asesor"
            maxLength={1_000}
            disabled={remoteParticipantCount === 0}
          />
          <button
            type="submit"
            aria-label="Enviar mensaje al asesor"
            disabled={remoteParticipantCount === 0 || !chatDraft.trim()}
          >
            <Send size={15} />
          </button>
        </form>
      </div>
      {requestError || audioError || chatError ? (
        <p role="alert">{requestError || audioError || chatError}</p>
      ) : null}
      <div ref={audioRootRef} hidden />
    </section>
  );
}
