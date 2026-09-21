"use client";

import Image from "next/image";
import {
  Bot,
  Check,
  CircleGauge,
  MapPin,
  Mic,
  PackageCheck,
  PhoneOff,
  RotateCcw,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  UserRound,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { AgentAudioVisualizerAura } from "@/components/agents-ui/agent-audio-visualizer-aura";
import { useCatalog } from "@/features/catalog/catalog-context";
import { ClientHandoffPanel } from "@/features/handoff/client-handoff-panel";
import { applyVoiceTranscriptUpdate } from "@/features/voice/transcript-stream";
import { useGeminiLiveAssistant } from "@/features/voice/use-gemini-live-assistant";
import { useWebMcp } from "@/features/webmcp/use-webmcp";
import { formatUsd, getTireById } from "@/lib/catalog-search";
import { runAgentTurn } from "@/lib/agent-client";
import type { ChatMessage } from "@/types/agent";
import type { CatalogState, Tire } from "@/types/catalog";

import styles from "./search-to-sale-experience.module.css";

function createLocalId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const initialMessages: ChatMessage[] = [{
  id: "welcome",
  role: "assistant",
  content:
    "Hola. Puedo buscar llantas por vehículo o medida, revisar precio y stock actual, y preparar una cotización informativa.",
}];

function formatQueryTime(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function CameraPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={styles.cameraPreview} aria-label="Vista previa de la cámara">
      <video ref={videoRef} autoPlay muted playsInline />
      <span className={styles.cameraLive}><i /> Cámara activa</span>
    </div>
  );
}

function criteriaLabel(state: CatalogState): string {
  if (!state.criteria) return "Esperando una consulta";
  if (state.criteria.mode === "vehicle") {
    return `${state.criteria.make} ${state.criteria.model} ${state.criteria.year}`;
  }
  const size = [
    state.criteria.width,
    state.criteria.height && `/${state.criteria.height}`,
    state.criteria.rim && `R${state.criteria.rim}`,
  ].filter(Boolean).join("");
  return size || state.criteria.brand || "Catálogo por categoría";
}

function ProductCard({ tire, selected, priority, onSelect }: {
  tire: Tire;
  selected: boolean;
  priority: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`${styles.productCard} ${selected ? styles.selected : ""}`}>
      <div className={styles.productImageWrap}>
        {tire.image ? (
          <Image
            src={tire.image}
            alt={tire.name}
            width={420}
            height={300}
            className={styles.productImage}
            priority={priority}
          />
        ) : (
          <div className={styles.productPlaceholder}>
            <CircleGauge size={42} aria-hidden="true" />
            <strong>{tire.size || tire.code}</strong>
            <span>Imagen no disponible</span>
          </div>
        )}
        {selected ? (
          <span className={styles.selectedBadge}>
            <Check size={14} strokeWidth={3} /> Seleccionada
          </span>
        ) : null}
      </div>
      <div className={styles.productBody}>
        <span className={styles.family}>{tire.categoryLabel} · {tire.brand}</span>
        <h3>{tire.name}</h3>
        <p>{tire.details || `${tire.tread || "Labrado no informado"} · ${tire.application || "Aplicación no informada"}`}</p>
        <div className={styles.metrics}>
          <span><strong>{tire.size || "N/D"}</strong> Medida</span>
          <span><strong>{tire.application || "N/D"}</strong> Aplicación</span>
          <span><strong>{tire.speedDescription || "N/D"}</strong> Velocidad</span>
        </div>
        <div className={styles.stockList} aria-label="Stock por local">
          {tire.warehouses.length ? tire.warehouses.map((warehouse) => (
            <span key={`${warehouse.cityCode}-${warehouse.warehouseCode}`}>
              <MapPin size={13} /> {warehouse.cityCode} · {warehouse.warehouseName}: <strong>{warehouse.quantity}</strong>
            </span>
          )) : <span>Stock no informado</span>}
          {tire.availability.requiresMultipleWarehouses ? (
            <span>La cantidad solicitada requiere combinar bodegas.</span>
          ) : null}
          {tire.stockDiscrepancy ? <span>{tire.stockDiscrepancy}</span> : null}
        </div>
        <div className={styles.productFooter}>
          <div className={styles.priceBlock}>
            <strong>{formatUsd(tire.price.unitWithoutVat)}</strong>
            {tire.price.status === "available" ? (
              <span>+ IVA · Total conocido {formatUsd(tire.price.unitKnownChargesTotal)}</span>
            ) : null}
          </div>
          <button type="button" onClick={onSelect}>
            {selected ? "Ver detalle" : "Seleccionar"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function SearchToSaleExperience({
  embedded = false,
  initialQuery,
}: {
  embedded?: boolean;
  initialQuery?: string;
}) {
  const { state, actions } = useCatalog();
  const webMcpStatus = useWebMcp(actions);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoffActive, setHandoffActive] = useState(false);
  const [sheet, setSheet] = useState<"closed" | "peek" | "half" | "full">("closed");
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const sheetDrag = useRef<{ y: number; height: number } | null>(null);
  const sheetMoved = useRef(false);
  const sessionId = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const quoteRef = useRef<HTMLElement>(null);
  const initialQuerySubmitted = useRef(false);
  const stateRef = useRef(state);
  const voiceTranscriptIds = useRef<Record<"user" | "assistant", string | null>>({
    user: null,
    assistant: null,
  });
  const handleVoiceTranscript = useCallback((
    role: "user" | "assistant",
    text: string,
    final: boolean,
  ) => {
    const activeMessageId = voiceTranscriptIds.current[role] ?? createLocalId();
    voiceTranscriptIds.current[role] = final ? null : activeMessageId;
    setMessages((current) => {
      const result = applyVoiceTranscriptUpdate({
        messages: current,
        activeMessageId,
        update: { role, text, final },
        createId: () => activeMessageId,
      });
      return result.messages;
    });
    setSheet("half");
  }, []);
  const voice = useGeminiLiveAssistant({
    enabled: webMcpStatus === "ready" && !handoffActive,
    onTranscript: handleVoiceTranscript,
  });

  const selected = state.selectedTireId ? getTireById(state.tires, state.selectedTireId) : null;
  const queriedAt = formatQueryTime(state.queriedAt);
  const cartQuantity = state.quote?.quantity ?? 0;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (handoffActive && voice.active) void voice.stop();
  }, [handoffActive, voice]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [busy, messages]);

  useEffect(() => {
    if (
      !initialQuery ||
      initialQuerySubmitted.current ||
      busy ||
      handoffActive ||
      webMcpStatus !== "ready"
    ) {
      return;
    }
    initialQuerySubmitted.current = true;
    searchFormRef.current?.requestSubmit();
  }, [busy, handoffActive, initialQuery, webMcpStatus]);

  async function sendMessage(content: string) {
    const text = content.trim();
    if (!text || busy || handoffActive || webMcpStatus !== "ready") return;
    const userMessage: ChatMessage = { id: createLocalId(), role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setBusy(true);
    setSheet("half");
    try {
      const currentSessionId = sessionId.current ??= createLocalId();
      const response = await runAgentTurn({
        sessionId: currentSessionId,
        messages: nextMessages,
        getUiState: () => stateRef.current,
      });
      setMessages((current) => [
        ...current,
        { id: createLocalId(), role: "assistant", content: response },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createLocalId(),
          role: "assistant",
          content: error instanceof Error
            ? `No pude completar la solicitud: ${error.message}`
            : "No pude completar la solicitud.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(state.query);
  }

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function cycleSheet() {
    if (sheetMoved.current) { sheetMoved.current = false; return; }
    setSheetHeight(null);
    setSheet((current) => current === "closed" ? "peek" : current === "peek" ? "half" : current === "half" ? "full" : "peek");
  }

  function toggleSheet() {
    if (sheet === "closed" && sheetHeight !== null && sheetHeight < 10) setSheetHeight(50);
    setSheet((current) => current === "closed" ? "half" : "closed");
  }

  return (
    <main className={`${styles.appShell} ${embedded ? styles.fullseguraTheme : ""}`}>
      {!embedded ? <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="Buscador IA de Llantas inicio">
          <span className={styles.logoMark}><CircleGauge size={21} /></span>
          <span>Buscador IA <span>de Llantas</span></span>
        </a>
        <nav className={styles.nav} aria-label="Navegación principal">
          <a href="#top">Buscar</a>
          <a href="#results">Resultados</a>
          <a href="#agent">Asesor</a>
        </nav>
        <div className={styles.headerMeta}>
          <span><PackageCheck size={16} /> Fuente pública PowerLlanta</span>
          <span
            className={styles.headerCart}
            aria-label={cartQuantity
              ? `${cartQuantity} ${cartQuantity === 1 ? "llanta cotizada" : "llantas cotizadas"}`
              : "Sin cotización"}
          >
            <ShoppingCart size={18} />
            {cartQuantity ? <b>{cartQuantity}</b> : null}
          </span>
          <button type="button" onClick={actions.reset} aria-label="Reiniciar búsqueda">
            <RotateCcw size={16} /> Reiniciar
          </button>
        </div>
      </header> : null}

      <div className={styles.workspace + (sheet === "closed" ? ` ${styles.agentClosed}` : "")} id="top">
        <section className={styles.storePanel} aria-label="Catálogo de llantas">
          <div className={styles.hero}>
            <div className={styles.heroHeading}>
              <div>
                <h1>Buscador IA de Llantas</h1>
                <p>Consulta por vehículo, medida, marca, ciudad, cantidad o presupuesto.</p>
              </div>
              {embedded ? (
                <button
                  className={styles.embeddedCart}
                  type="button"
                  disabled={!cartQuantity}
                  onClick={() => quoteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  aria-label={cartQuantity
                    ? `Ver cotización de ${cartQuantity} ${cartQuantity === 1 ? "llanta" : "llantas"}`
                    : "Sin cotización"}
                  title={cartQuantity ? "Ver cotización" : "Sin cotización"}
                >
                  <ShoppingCart size={20} aria-hidden="true" />
                  {cartQuantity ? <b>{cartQuantity}</b> : null}
                </button>
              ) : null}
            </div>
            <form ref={searchFormRef} className={styles.searchForm} onSubmit={submitSearch} suppressHydrationWarning>
              <Search size={21} aria-hidden="true" />
              <input
                value={state.query}
                onChange={(event) => actions.setQuery(event.target.value)}
                placeholder="Ej. Toyota RAV4 2018 en Quito o 225/65R17"
                aria-label="Describe la llanta que necesitas"
                suppressHydrationWarning
              />
              <button disabled={webMcpStatus !== "ready" || busy || handoffActive}>Buscar</button>
            </form>
            {webMcpStatus === "unsupported" ? (
              <p className={styles.compatibilityNotice} role="status">
                Este navegador no ofrece WebMCP nativo; la búsqueda asistida está deshabilitada.
              </p>
            ) : null}
          </div>

          <div className={styles.resultsSection} id="results">
            <div className={styles.resultsHeading}>
              <div>
                <span>{queriedAt ? `Consultado ${queriedAt} · PowerLlanta` : "Resultados en tiempo real"}</span>
                <h2>{criteriaLabel(state)}</h2>
              </div>
              <span>{state.tires.length} opciones</span>
            </div>

            {state.stockSummary ? (
              <section className={styles.stockSummary} aria-label="Resumen de stock">
                <div>
                  <span>Stock reportado</span>
                  <strong>{state.stockSummary.totalUnits.toLocaleString("es-EC")} unidades</strong>
                </div>
                <div className={styles.stockSummaryGroups}>
                  {state.stockSummary.groups.map((group) => (
                    <span key={`${group.cityCode}-${group.warehouseCode}`}>
                      {group.cityCode} · {group.warehouseName}: <strong>{group.quantity.toLocaleString("es-EC")}</strong>
                    </span>
                  ))}
                </div>
                <p>{state.stockSummary.note}</p>
              </section>
            ) : null}

            {selected ? state.quote ? (
              <section ref={quoteRef} className={`${styles.detailCard} ${styles.quoteExpanded}`} aria-label="Cotización">
                <div className={styles.quoteProduct}>
                  <span className={styles.family}>Cotización informativa</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.size} · {selected.brand} · Código {selected.code}</p>
                </div>
                <div className={styles.quoteBreakdown}>
                  <span className={styles.quoteMetric}>
                    <small>Cantidad</small>
                    <strong>{state.quote.quantity}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Local</small>
                    <strong>{state.quote.warehouse
                      ? `${state.quote.warehouse.cityCode} · ${state.quote.warehouse.warehouseName}`
                      : state.quote.requiresMultipleWarehouses ? "Varias bodegas" : "Sin local asignado"}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Stock reportado</small>
                    <strong>{state.quote.availableUnits} unidades</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Unitario sin IVA</small>
                    <strong>{formatUsd(state.quote.unitWithoutVat)}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Subtotal sin IVA</small>
                    <strong>{formatUsd(state.quote.subtotalWithoutVat)}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>EcoValor</small>
                    <strong>{formatUsd(state.quote.ecoValueTotal)}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>IVA{state.quote.vatPercent === null ? "" : ` (${state.quote.vatPercent}%)`}</small>
                    <strong>{formatUsd(state.quote.vatTotal)}</strong>
                  </span>
                  <span className={`${styles.quoteMetric} ${styles.quoteTotal}`}>
                    <small>Total con cargos conocidos</small>
                    <strong>{formatUsd(state.quote.totalKnownCharges)}</strong>
                  </span>
                </div>
                <button className={styles.quoteRemove} type="button" onClick={actions.clearQuote}>
                  <ShoppingCart size={16} /> Quitar cotización
                </button>
              </section>
            ) : (
              <section className={styles.detailCard} aria-label="Detalle seleccionado">
                <div>
                  <span className={styles.family}>Selección actual</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.size} · {selected.brand} · Código {selected.code}</p>
                </div>
                <div className={styles.quoteArea}>
                  <div>
                    <span>Precio unitario sin IVA</span>
                    <strong>{formatUsd(selected.price.unitWithoutVat)}</strong>
                  </div>
                  <button type="button" onClick={() => actions.prepareQuote(selected.id, 1, "total")}>
                    <ShoppingCart size={16} /> Cotizar una
                  </button>
                </div>
              </section>
            ) : null}

            {state.tires.length ? (
              <div className={styles.productGrid}>
                {state.tires.map((tire, index) => (
                  <ProductCard
                    key={tire.id}
                    tire={tire}
                    selected={tire.id === state.selectedTireId}
                    priority={index === 0}
                    onSelect={() => actions.selectTire(tire.id)}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <CircleGauge size={34} />
                <div><strong>Describe tu necesidad para consultar el catálogo actual.</strong><span>No se almacena una copia local.</span></div>
              </div>
            )}
          </div>
        </section>

        <aside className={`${styles.agentPanel} ${styles[`sheet-${sheet}`]}`} style={sheet !== "closed" && sheetHeight !== null ? { height: `${sheetHeight}dvh`, minHeight: 0, transition: "none" } : undefined} id="agent" aria-label="Agente de llantas">
          <button className={styles.sheetHandle} type="button" onClick={cycleSheet} aria-label="Cambiar altura del agente"
            onPointerDown={(event) => {
              sheetMoved.current = false;
              sheetDrag.current = { y: event.clientY, height: event.currentTarget.parentElement!.getBoundingClientRect().height / window.innerHeight * 100 };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = sheetDrag.current;
              if (!drag || Math.abs(event.clientY - drag.y) < 3) return;
              sheetMoved.current = true;
              setSheet("half");
              setSheetHeight(Math.max(0, Math.min(100, drag.height + (drag.y - event.clientY) / window.innerHeight * 100)));
            }}
            onPointerUp={(event) => {
              if (sheetDrag.current && sheetMoved.current && (sheetHeight ?? 50) < 10) setSheet("closed");
              sheetDrag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { sheetDrag.current = null; }}
            onLostPointerCapture={() => { sheetDrag.current = null; }}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              if (event.key === "Home") { setSheet("closed"); return; }
              setSheet("half");
              setSheetHeight(height => event.key === "End" ? 100 : Math.max(10, Math.min(100, (height ?? 50) + (event.key === "ArrowUp" ? 5 : -5))));
            }}
          ><span /></button>
          <div className={styles.agentHeader}>
            <div className={styles.agentIdentity}>
              <span className={`${styles.agentIcon} ${voice.active ? styles.voiceAura : ""}`}>
                {voice.active ? (
                  <AgentAudioVisualizerAura
                    size="icon"
                    state={voice.status === "speaking" ? "speaking"
                      : voice.status === "thinking" ? "thinking"
                      : voice.status === "listening" ? "listening"
                      : "connecting"}
                    volume={voice.volume}
                    color={embedded ? "#6f50bf" : "#f6a800"}
                    themeMode="light"
                  />
                ) : <Bot size={22} />}
              </span>
              <div>
                <strong>Asesor de llantas</strong>
                <span><i /> {voice.status === "connecting" ? "Conectando"
                  : voice.status === "listening" ? "Escuchando"
                  : voice.status === "thinking" ? "Pensando"
                  : voice.status === "speaking" ? "Hablando"
                  : voice.status === "error" ? "Voz no disponible"
                  : "En línea"}</span>
              </div>
            </div>
            <div className={styles.agentControls}>
              <button
                className={styles.cameraToggle}
                type="button"
                onClick={() => {
                  if (voice.cameraActive) {
                    void voice.stopCamera();
                    return;
                  }
                  setSheetHeight(null);
                  setSheet("full");
                  void voice.startCamera();
                }}
                disabled={webMcpStatus !== "ready" || handoffActive || voice.status === "connecting" || voice.cameraStarting}
                aria-label={voice.cameraActive ? "Detener cámara" : "Mostrar llanta con la cámara"}
                aria-pressed={voice.cameraActive}
                title={voice.cameraActive ? "Detener cámara" : "Mostrar llanta"}
              >
                {voice.cameraActive ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
              <button
                className={styles.voiceToggle}
                type="button"
                onClick={() => { void (voice.active ? voice.stop() : voice.start()); }}
                disabled={webMcpStatus !== "ready" || handoffActive || voice.status === "connecting"}
                aria-label={voice.active ? "Detener asistente de voz" : "Iniciar asistente de voz"}
                aria-pressed={voice.active}
                title={voice.active ? "Detener voz" : "Hablar con el asesor"}
              >
                {voice.active ? <PhoneOff size={18} /> : <Mic size={18} />}
              </button>
              <button className={styles.sheetToggle} type="button" onClick={toggleSheet} aria-label={sheet === "closed" ? "Abrir agente" : "Cerrar agente"} aria-expanded={sheet !== "closed"}>
                {sheet === "closed" ? <Bot size={22} /> : <X size={20} />}
              </button>
            </div>
          </div>

          {voice.cameraStream ? <CameraPreview stream={voice.cameraStream} /> : null}

          <div ref={messagesRef} className={styles.messages} aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`${styles.messageRow} ${styles[message.role]}`}>
                <span className={styles.avatar}>{message.role === "assistant" ? <Sparkles size={15} /> : <UserRound size={15} />}</span>
                <p>{message.content}</p>
              </div>
            ))}
            {busy ? (
              <div className={`${styles.messageRow} ${styles.assistant}`}>
                <span className={styles.avatar}><Sparkles size={15} /></span>
                <p className={styles.thinking}><span>Consultando PowerLlanta…</span><span className={styles.thinkingDots} aria-hidden="true"><i /><i /><i /></span></p>
              </div>
            ) : null}
          </div>

          <ClientHandoffPanel
            messages={messages}
            vehicle={state.criteria?.mode === "vehicle" ? `${state.criteria.make} ${state.criteria.model} ${state.criteria.year}` : state.query.trim() || null}
            tire={selected ? {
              id: selected.id,
              name: selected.name,
              image: selected.image,
              price: selected.price.unitKnownChargesTotal ?? 0,
              quantity: state.quote?.quantity ?? 1,
              total: state.quote?.totalKnownCharges ?? selected.price.unitKnownChargesTotal ?? 0,
            } : null}
            onActiveChange={setHandoffActive}
          />

          {voice.error ? <p className={styles.voiceError} role="status">{voice.error}</p> : null}

          {!handoffActive ? (
            <form className={styles.chatComposer} onSubmit={submitChat} suppressHydrationWarning>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={webMcpStatus === "ready" ? "Escribe al asesor…" : "WebMCP requerido"} disabled={webMcpStatus !== "ready" || busy} aria-label="Mensaje para el asesor" suppressHydrationWarning />
              <button disabled={!draft.trim() || busy || webMcpStatus !== "ready"} aria-label="Enviar mensaje"><Send size={18} /></button>
            </form>
          ) : null}
          <p className={styles.disclaimer}>Precios y stock reportados al consultar. No se crean reservas, pedidos ni cobros.</p>
        </aside>
      </div>
    </main>
  );
}
