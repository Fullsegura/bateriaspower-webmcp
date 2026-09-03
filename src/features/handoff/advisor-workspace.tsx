"use client";

import Image from "next/image";
import {
  BatteryCharging,
  Clock3,
  Headphones,
  LogOut,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Search,
  Send,
  UserRound,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LiveKitConnection, PublicHandoffCase } from "@/features/handoff/types";
import {
  hasWaitingAdvisorCall,
  useForegroundCallSounds,
} from "@/features/handoff/use-foreground-call-sounds";
import { useLiveKitAudio } from "@/features/handoff/use-livekit-audio";

import styles from "./advisor-workspace.module.css";

async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || "Solicitud no disponible.");
  return body;
}

function statusLabel(status: PublicHandoffCase["status"]) {
  if (status === "waiting") return "En espera";
  if (status === "accepted") return "Aceptado";
  if (status === "connected") return "En llamada";
  return "Finalizado";
}

export function AdvisorWorkspace() {
  const [accessToken, setAccessToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [cases, setCases] = useState<PublicHandoffCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [advisorName, setAdvisorName] = useState("Asesor BateríasPower");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectedCaseId, setConnectedCaseId] = useState<string | null>(null);
  const [liveDraft, setLiveDraft] = useState("");
  const [liveChatError, setLiveChatError] = useState<string | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const liveMessagesRef = useRef<HTMLDivElement>(null);
  const { playHangup, startRinging, stopRinging, unlock } = useForegroundCallSounds();
  const {
    audioRootRef,
    connect: connectAudio,
    disconnect: disconnectAudio,
    error: audioError,
    muted,
    remoteParticipantCount,
    sendText: sendLiveText,
    state: audioState,
    textMessages,
    toggleMute,
  } = useLiveKitAudio();

  const loadCases = useCallback(async (token: string) => {
    const response = await fetch("/api/handoff/cases", {
      cache: "no-store",
      headers: { authorization: "Bearer " + token },
    });
    const body = await readJson(response);
    const nextCases = body.cases as PublicHandoffCase[];
    setCases(nextCases);
    setSelectedId((current) =>
      current && nextCases.some((item) => item.id === current)
        ? current
        : nextCases.find((item) => item.status !== "ended")?.id || nextCases[0]?.id || null,
    );
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    const initialTimer = window.setTimeout(() => {
      void loadCases(accessToken).catch((caught) => {
        setError(caught instanceof Error ? caught.message : "No fue posible cargar la cola.");
      });
    }, 0);
    const timer = window.setInterval(() => {
      void loadCases(accessToken).catch(() => undefined);
    }, 2_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [accessToken, loadCases]);

  const activeCall = connectedCaseId
    ? cases.find((item) => item.id === connectedCaseId) || null
    : null;
  const incomingCall = activeCall
    ? null
    : cases.find((item) => item.status === "waiting") || null;
  const hasWaitingCall = !activeCall && hasWaitingAdvisorCall(cases);

  useEffect(() => {
    if (accessToken && hasWaitingCall) startRinging();
    else stopRinging();
  }, [accessToken, hasWaitingCall, startRinging, stopRinging]);

  useEffect(() => {
    const activeCallId = activeCallIdRef.current;
    if (!activeCallId) return;
    const activeCall = cases.find((item) => item.id === activeCallId);
    if (activeCall?.status !== "ended") return;
    activeCallIdRef.current = null;
    setConnectedCaseId(null);
    void disconnectAudio().catch(() => undefined);
    playHangup();
  }, [cases, disconnectAudio, playHangup]);

  useEffect(() => {
    const container = liveMessagesRef.current;
    if (!container) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [textMessages.length]);

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return cases;
    return cases.filter((item) => {
      const haystack = [
        item.customerName,
        item.context.vehicle || "",
        item.context.battery?.name || "",
      ].join(" ").toLocaleLowerCase("es");
      return haystack.includes(normalized);
    });
  }, [cases, query]);

  const selected = cases.find((item) => item.id === selectedId) || null;

  function login(event: FormEvent) {
    event.preventDefault();
    const token = draftToken.trim();
    if (!token) return;
    unlock();
    setAccessToken(token);
    setError(null);
  }

  async function caseAction(
    action: "accept" | "end",
    targetCase: PublicHandoffCase | null = selected,
  ) {
    if (!targetCase) return;
    if (action === "accept") setSelectedId(targetCase.id);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/handoff/cases/" + targetCase.id, {
        method: "POST",
        headers: {
          authorization: "Bearer " + accessToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action, advisorName }),
      });
      const body = await readJson(response);
      if (action === "accept") {
        stopRinging();
        activeCallIdRef.current = targetCase.id;
        setConnectedCaseId(targetCase.id);
        setLiveDraft("");
        setLiveChatError(null);
        await connectAudio(body.connection as LiveKitConnection);
      } else {
        stopRinging();
        setConnectedCaseId(null);
        await disconnectAudio();
      }
      await loadCases(accessToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar el caso.");
    } finally {
      setBusy(false);
    }
  }

  async function submitLiveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = liveDraft.trim();
    if (!content || audioState !== "connected" || remoteParticipantCount === 0) return;
    setLiveChatError(null);
    try {
      await sendLiveText(content);
      setLiveDraft("");
    } catch (caught) {
      setLiveChatError(caught instanceof Error ? caught.message : "No se pudo enviar el mensaje.");
    }
  }

  if (!accessToken) {
    return (
      <main className={styles.loginPage}>
        <form className={styles.loginCard} onSubmit={login}>
          <span className={styles.logo}><Zap size={24} fill="currentColor" /></span>
          <h1>Acceso de asesor</h1>
          <p>Ingresa la clave del sitio autónomo BateríasPower.</p>
          <label>
            Clave de acceso
            <input
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button>Ingresar</button>
        </form>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="/search">
          <span className={styles.logo}><Zap size={18} fill="currentColor" /></span>
          <strong>Baterías<span>Power</span></strong>
        </a>
        <div className={styles.advisorMeta}>
          <Headphones size={18} />
          <input
            value={advisorName}
            onChange={(event) => setAdvisorName(event.target.value)}
            aria-label="Nombre del asesor"
          />
          <button
            type="button"
            onClick={() => {
              stopRinging();
              setConnectedCaseId(null);
              setAccessToken("");
              setCases([]);
            }}
          >
            <LogOut size={16} /> Salir
          </button>
        </div>
      </header>

      {incomingCall ? (
        <div className={styles.incomingCallOverlay}>
          <section
            className={styles.incomingCallDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="incoming-call-title"
          >
            <span className={styles.incomingCallIcon}>
              <PhoneCall size={24} />
            </span>
            <span className={styles.incomingCallLabel}>Llamada entrante</span>
            <h2 id="incoming-call-title">{incomingCall.customerName}</h2>
            <p>{incomingCall.context.vehicle || "Vehículo no especificado"}</p>
            <div className={styles.incomingCallActions}>
              <button
                type="button"
                className={styles.rejectCall}
                disabled={busy}
                onClick={() => void caseAction("end", incomingCall)}
              >
                <PhoneOff size={17} /> Rechazar
              </button>
              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => void caseAction("accept", incomingCall)}
              >
                <PhoneCall size={17} />
                {busy ? "Conectando…" : "Contestar"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeCall && activeCall.status !== "ended" ? (
        <section className={styles.activeCallDock} aria-label="Controles de llamada">
          <div>
            <span>{audioState === "connected" ? "Llamada en curso" : "Conectando llamada"}</span>
            <strong>{activeCall.customerName}</strong>
          </div>
          <div className={styles.activeCallActions}>
            <button
              type="button"
              className={styles.muteCall}
              disabled={audioState !== "connected"}
              onClick={() => void toggleMute()}
              aria-label={muted ? "Activar micrófono" : "Silenciar"}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              type="button"
              className={styles.endCall}
              onClick={() => void caseAction("end", activeCall)}
              aria-label="Finalizar llamada"
            >
              <PhoneOff size={18} />
            </button>
          </div>
        </section>
      ) : null}

      <div className={styles.workspace}>
        <aside className={styles.queue}>
          <div className={styles.queueHeader}>
            <div>
              <span>Handoff autónomo</span>
              <h1>Casos de voz</h1>
            </div>
            <button type="button" onClick={() => void loadCases(accessToken)}>
              <RefreshCw size={16} />
            </button>
          </div>
          <label className={styles.search}>
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cliente o vehículo"
            />
          </label>
          <div className={styles.caseList}>
            {filteredCases.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? styles.selectedCase : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <span className={styles.caseTop}>
                  <strong>{item.customerName}</strong>
                  <i data-status={item.status}>{statusLabel(item.status)}</i>
                </span>
                <span>{item.context.vehicle || "Vehículo no indicado"}</span>
                <small><Clock3 size={12} /> {new Date(item.createdAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</small>
              </button>
            ))}
            {!filteredCases.length ? (
              <div className={styles.emptyQueue}>
                <PhoneCall size={24} />
                <p>No hay casos que coincidan.</p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={styles.caseDetail}>
          {selected ? (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <span>{statusLabel(selected.status)}</span>
                  <h2>{selected.customerName}</h2>
                  <p>{selected.context.vehicle || "Sin vehículo especificado"}</p>
                </div>
                <div className={styles.callActions}>
                  {selected.status === "waiting" ? (
                    <button
                      type="button"
                      onClick={() => void caseAction("accept")}
                      disabled={busy}
                    >
                      <PhoneCall size={17} /> {busy ? "Conectando…" : "Aceptar llamada"}
                    </button>
                  ) : selected.status !== "ended" ? (
                    <>
                      {audioState !== "connected" ? (
                        <button type="button" onClick={() => void caseAction("accept")} disabled={busy}>
                          <PhoneCall size={17} /> Conectar audio
                        </button>
                      ) : (
                        <button type="button" className={styles.secondary} onClick={() => void toggleMute()}>
                          {muted ? <MicOff size={17} /> : <Mic size={17} />}
                          {muted ? "Activar micrófono" : "Silenciar"}
                        </button>
                      )}
                      <button type="button" className={styles.danger} onClick={() => void caseAction("end")}>
                        <PhoneOff size={17} /> Finalizar
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className={styles.caseContent}>

              <div className={styles.contextGrid}>
                <article>
                  <span><BatteryCharging size={16} /> Selección compartida</span>
                  <strong>{selected.context.battery?.name || "Sin batería seleccionada"}</strong>
                  {selected.context.battery ? (
                    <>
                      {selected.context.battery.image ? (
                        <Image
                          className={styles.sharedProductImage}
                          src={selected.context.battery.image}
                          alt={selected.context.battery.name}
                          width={260}
                          height={190}
                        />
                      ) : null}
                      <p>
                        {selected.context.battery.quantity} unidad ·
                        {" $" + selected.context.battery.total.toFixed(2)}
                      </p>
                    </>
                  ) : <p>El cliente todavía no agregó un producto.</p>}
                </article>
                <article>
                  <span><UserRound size={16} /> Estado de voz</span>
                  <strong>{remoteParticipantCount > 0 ? "Cliente conectado" : statusLabel(selected.status)}</strong>
                  <p>{audioState === "connected" ? "Audio activo" : "Esperando conexión de audio"}</p>
                </article>
              </div>

              <div className={styles.transcript}>
                <h3>Contexto de la conversación</h3>
                {selected.transcript.map((message) => (
                  <div key={message.id} data-role={message.role}>
                    <span>{message.role === "assistant" ? "Agente" : "Cliente"}</span>
                    <p>{message.content}</p>
                  </div>
                ))}
                {!selected.transcript.length ? <p>Sin mensajes previos.</p> : null}
              </div>

              </div>

              {selected.id === connectedCaseId ? (
                <section className={styles.liveChat} aria-label="Chat en vivo con el cliente">
                  <h3>Chat en vivo</h3>
                  <div ref={liveMessagesRef} className={styles.liveMessages} aria-live="polite">
                    {textMessages.map((message) => (
                      <p key={message.id} data-direction={message.direction}>
                        <span>{message.direction === "local" ? "Tú" : "Cliente"}</span>
                        {message.content}
                      </p>
                    ))}
                    {!textMessages.length ? (
                      <small>
                        {remoteParticipantCount > 0
                          ? "Puedes escribir mientras continúa la llamada."
                          : "Esperando la conexión del cliente."}
                      </small>
                    ) : null}
                  </div>
                  {selected.status !== "ended" ? (
                    <form className={styles.liveComposer} onSubmit={submitLiveText}>
                      <input
                        value={liveDraft}
                        onChange={(event) => setLiveDraft(event.target.value)}
                        placeholder={remoteParticipantCount > 0 ? "Escribe al cliente…" : "Esperando al cliente…"}
                        aria-label="Mensaje para el cliente"
                        maxLength={1_000}
                        disabled={audioState !== "connected" || remoteParticipantCount === 0}
                      />
                      <button
                        type="submit"
                        aria-label="Enviar mensaje al cliente"
                        disabled={
                          audioState !== "connected" ||
                          remoteParticipantCount === 0 ||
                          !liveDraft.trim()
                        }
                      >
                        <Send size={16} />
                      </button>
                    </form>
                  ) : null}
                  {liveChatError ? <p className={styles.error} role="alert">{liveChatError}</p> : null}
                </section>
              ) : null}
            </>
          ) : (
            <div className={styles.emptyDetail}>
              <PhoneCall size={32} />
              <h2>Selecciona un caso</h2>
              <p>Las solicitudes del cliente aparecerán aquí.</p>
            </div>
          )}
          {error || audioError ? <p className={styles.error} role="alert">{error || audioError}</p> : null}
          <div ref={audioRootRef} hidden />
        </section>
      </div>
    </main>
  );
}
