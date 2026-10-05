"use client";

import Image from "next/image";
import {
  BatteryCharging,
  Bot,
  Check,
  CircleGauge,
  CreditCard,
  MapPin,
  PackageCheck,
  Phone,
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
import { PaymentDialog } from "@/features/payments/payment-dialog";
import { useCheckout } from "@/features/payments/use-checkout";
import { applyVoiceTranscriptUpdate } from "@/features/voice/transcript-stream";
import { useGeminiLiveAssistant } from "@/features/voice/use-gemini-live-assistant";
import { useWebMcp } from "@/features/webmcp/use-webmcp";
import { formatUsd, getTireById } from "@/lib/catalog-search";
import { runAgentTurn } from "@/lib/agent-client";
import type { AgentEvent, ChatMessage } from "@/types/agent";
import type { Battery, CatalogState, Tire } from "@/types/catalog";

import styles from "./search-to-sale-experience.module.css";

function createLocalId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const initialMessages: ChatMessage[] = [{
  id: "welcome",
  role: "assistant",
  content:
    "Hola. Puedo ayudarte a encontrar llantas o baterías para tu vehículo y preparar una cotización.",
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
  if (state.activeProductType === "battery" && state.batteryCriteria) {
    const { make, model, year, engine } = state.batteryCriteria;
    return [make, model, year, engine ? `motor ${engine}` : null].filter(Boolean).join(" ");
  }
  if (state.activeProductType === "battery" && state.batteries.length) return "Baterías para comparar";
  if (!state.criteria) return "Esperando una consulta";
  if (state.criteria.mode === "vehicle") {
    return state.resolvedVehicle
      ? `${state.resolvedVehicle.make} ${state.resolvedVehicle.model} ${state.resolvedVehicle.year}`
      : "Vehículo seleccionado";
  }
  const size = [
    state.criteria.width,
    state.criteria.height && `/${state.criteria.height}`,
    state.criteria.rim && `R${state.criteria.rim}`,
  ].filter(Boolean).join("");
  return size || "Catálogo por categoría";
}

function TireProductCard({ tire, selected, priority, onSelect, onActivate, cardRef }: {
  tire: Tire;
  selected: boolean;
  priority: boolean;
  onSelect?: () => void;
  onActivate?: () => void;
  cardRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <article
      ref={cardRef}
      className={`${styles.productCard} ${selected ? styles.selected : ""} ${onActivate ? styles.productCardAction : ""}`}
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? `Buscar ${tire.name}` : undefined}
      onClick={onActivate}
      onKeyDown={onActivate ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate();
      } : undefined}
    >
      <div className={styles.productImageWrap}>
        {tire.image ? (
          <Image
            src={tire.image}
            alt={tire.name}
            width={420}
            height={300}
            className={styles.productImage}
            loading={priority ? "eager" : "lazy"}
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
          {onSelect ? (
            <button type="button" onClick={onSelect}>
              {selected ? "Ver detalle" : "Seleccionar"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function BatteryProductCard({ battery, selected, priority, onSelect, onActivate, cardRef }: {
  battery: Battery;
  selected: boolean;
  priority: boolean;
  onSelect?: () => void;
  onActivate?: () => void;
  cardRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <article
      ref={cardRef}
      className={`${styles.productCard} ${selected ? styles.selected : ""} ${onActivate ? styles.productCardAction : ""}`}
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? `Buscar ${battery.name}` : undefined}
      onClick={onActivate}
      onKeyDown={onActivate ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate();
      } : undefined}
    >
      <div className={styles.productImageWrap}>
        {battery.image ? (
          <Image
            src={battery.image.split("?", 1)[0]}
            alt={battery.name}
            width={420}
            height={300}
            className={styles.productImage}
            loading={priority ? "eager" : "lazy"}
          />
        ) : (
          <div className={styles.productPlaceholder}>
            <BatteryCharging size={42} aria-hidden="true" />
            <strong>{battery.code}</strong>
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
        <span className={styles.family}>{battery.family}</span>
        <h3>{battery.name}</h3>
        <p>{battery.description}</p>
        <div className={styles.metrics}>
          <span><strong>{battery.capacityAh}</strong> Ah</span>
          <span><strong>{battery.cca}</strong> CCA</span>
          <span><strong>{battery.reserveCapacityMinutes}</strong> min reserva</span>
        </div>
        <div className={styles.stockList} aria-label="Inventario por localidad">
          {battery.locations.map((location) => (
            <span key={location.location}>
              <MapPin size={13} /> {location.location}: <strong>{location.inventory}</strong>
            </span>
          ))}
          <span>Polaridad {battery.polarity} · {battery.dimensions}</span>
        </div>
        <div className={styles.productFooter}>
          <div className={styles.priceBlock}>
            <strong>{formatUsd(battery.price)}</strong>
            <span>Precio</span>
          </div>
          {onSelect ? (
            <button type="button" onClick={onSelect}>
              {selected ? "Ver detalle" : "Seleccionar"}
            </button>
          ) : null}
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
  const { state, actions, getSession, getState } = useCatalog();
  const payment = useCheckout(state, getSession);
  const paymentRef = useRef(payment);
  useEffect(() => { paymentRef.current = payment; }, [payment]);
  const webMcpStatus = useWebMcp(actions);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [batteryLocation, setBatteryLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlights, setHighlights] = useState<{ tire: Tire | null; battery: Battery | null } | null>(null);
  const [handoffActive, setHandoffActive] = useState(false);
  const [sheet, setSheet] = useState<"closed" | "peek" | "half" | "full">("closed");
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const sheetDrag = useRef<{ y: number; height: number } | null>(null);
  const sheetMoved = useRef(false);
  const sessionId = useRef<string | null>(null);
  const notifiedPayments = useRef(new Set<string>());
  const messagesRef = useRef<HTMLDivElement>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const restoreChatFocus = useRef(false);
  const quoteRef = useRef<HTMLElement>(null);
  const selectedProductRef = useRef<HTMLElement>(null);
  const initialQuerySubmitted = useRef(false);
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

  const selectedTire = state.selectedTireId ? getTireById(state.tires, state.selectedTireId) : null;
  const selectedBattery = state.selectedBatteryId
    ? state.batteries.find((battery) => battery.id === state.selectedBatteryId) ?? null
    : null;
  const queriedAt = formatQueryTime(state.queriedAt);
  const cartQuantity = payment.transaction?.status === "VALIDATED"
    ? 0
    : state.quote?.quantity ?? state.batteryQuote?.quantity ?? 0;
  const resultCount = state.activeProductType === "battery"
    ? state.batteries.length
    : state.tires.length;
  const hasSearchResults = state.tires.length > 0 || state.batteries.length > 0;
  const highlightCount = highlights
    ? Number(Boolean(highlights.tire)) + Number(Boolean(highlights.battery))
    : 0;

  useEffect(() => {
    setBatteryLocation(state.selectedBatteryLocationId ?? "");
  }, [state.selectedBatteryId, state.selectedBatteryLocationId]);

  useEffect(() => {
    if (!state.selectedBatteryId && !state.selectedTireId) return;
    const frame = requestAnimationFrame(() => {
      selectedProductRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.selectedBatteryId, state.selectedTireId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/catalog/highlights", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("No fue posible cargar los productos destacados.");
        return await response.json() as { tire: Tire | null; battery: Battery | null };
      })
      .then(setHighlights)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setHighlights({ tire: null, battery: null });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (handoffActive && voice.active) void voice.stop();
  }, [handoffActive, voice]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [busy, messages]);

  useEffect(() => {
    if (busy || handoffActive || webMcpStatus !== "ready" || !restoreChatFocus.current) return;
    restoreChatFocus.current = false;
    chatInputRef.current?.focus({ preventScroll: true });
  }, [busy, handoffActive, webMcpStatus]);

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

  const sendMessage = useCallback(async (content: string, event?: AgentEvent) => {
    const text = content.trim();
    if ((!text && !event) || busy || handoffActive || webMcpStatus !== "ready") return;
    const nextMessages = event ? messages : [
      ...messages, { id: createLocalId(), role: "user" as const, content: text },
    ];
    if (!event) {
      restoreChatFocus.current = true;
      setMessages(nextMessages);
      setDraft("");
    }
    setBusy(true);
    setSheet("half");
    try {
      const currentSessionId = sessionId.current ??= createLocalId();
      const response = await runAgentTurn({
        sessionId: currentSessionId,
        messages: nextMessages,
        getUiState: () => ({ ...getState(), checkout: paymentRef.current.getContext() }),
        event,
      });
      if (event && paymentRef.current.transaction?.id !== event.transactionId) return;
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
  }, [busy, getState, handoffActive, messages, webMcpStatus]);

  useEffect(() => {
    const transaction = payment.transaction;
    if (transaction?.status !== "VALIDATED" || busy || handoffActive || webMcpStatus !== "ready" ||
        notifiedPayments.current.has(transaction.id)) return;
    notifiedPayments.current.add(transaction.id);
    void sendMessage("", { type: "payment_status_changed", transactionId: transaction.id });
  }, [busy, handoffActive, payment.transaction, sendMessage, webMcpStatus]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(state.query);
  }

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function startHighlightedSearch(query: string) {
    if (busy || handoffActive || webMcpStatus !== "ready") return;
    actions.setQuery(query);
    setSheetHeight(null);
    setSheet("half");
    void sendMessage(query);
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
        <a className={styles.brand} href="#top" aria-label="PowerAuto inicio">
          <span className={styles.logoMark}><BatteryCharging size={21} /></span>
          <span>Power<span>Auto</span></span>
        </a>
        <nav className={styles.nav} aria-label="Navegación principal">
          <a href="#top">Buscar</a>
          <a href="#results">Resultados</a>
          <a href="#agent">Asesor</a>
        </nav>
        <div className={styles.headerMeta}>
          <span><PackageCheck size={16} /> Catálogo automotriz</span>
          <span
            className={styles.headerCart}
            aria-label={cartQuantity
              ? `${cartQuantity} ${cartQuantity === 1 ? "producto cotizado" : "productos cotizados"}`
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
        <section className={styles.storePanel} aria-label="Catálogo automotriz">
          <div className={styles.hero}>
            <div className={styles.heroHeading}>
              <div>
                <h1>PowerAuto</h1>
                <p>Encuentra llantas y baterías para tu vehículo.</p>
              </div>
              {embedded ? (
                <button
                  className={styles.embeddedCart}
                  type="button"
                  disabled={!cartQuantity}
                  onClick={() => quoteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  aria-label={cartQuantity
                    ? `Ver cotización de ${cartQuantity} ${cartQuantity === 1 ? "producto" : "productos"}`
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
                placeholder="Ej. batería para Toyota Corolla 2018 o llantas 225/65R17"
                aria-label="Describe el producto automotriz que necesitas"
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
                <span>{queriedAt ? `Consultado ${queriedAt} · PowerAuto` : "Explora el catálogo"}</span>
                <h2>{hasSearchResults ? criteriaLabel(state) : "Productos destacados"}</h2>
              </div>
              <span>{hasSearchResults ? resultCount : highlightCount} {(hasSearchResults ? resultCount : highlightCount) === 1 ? "opción" : "opciones"}</span>
            </div>

            {state.stockSummary ? (
              <section className={styles.stockSummary} aria-label="Resumen de stock">
                <div>
                  <span>Stock</span>
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

            {selectedBattery ? state.batteryQuote ? (
              <section ref={quoteRef} className={`${styles.detailCard} ${styles.quoteExpanded}`} aria-label="Cotización">
                <div className={styles.quoteProduct}>
                  <span className={styles.family}>Cotización</span>
                  <h2>{selectedBattery.name}</h2>
                  <p>{selectedBattery.family} · Código {selectedBattery.code}</p>
                </div>
                <div className={styles.quoteBreakdown}>
                  <span className={styles.quoteMetric}>
                    <small>Cantidad</small>
                    <strong>{state.batteryQuote.quantity}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Precio unitario</small>
                    <strong>{formatUsd(state.batteryQuote.unitPrice)}</strong>
                  </span>
                  <span className={`${styles.quoteMetric} ${styles.quoteTotal}`}>
                    <small>Total</small>
                    <strong>{formatUsd(state.batteryQuote.total)}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Retiro o entrega</small>
                    <strong>{state.batteryQuote.location.location}</strong>
                  </span>
                  <span className={styles.quoteMetric}>
                    <small>Inventario</small>
                    <strong>{state.batteryQuote.availableUnits} unidades</strong>
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
                  <h2>{selectedBattery.name}</h2>
                  <p>{selectedBattery.family} · Código {selectedBattery.code}</p>
                </div>
                <div className={styles.batteryQuoteArea}>
                  <label className={styles.batteryLocationPicker}>
                    <span>Retiro o entrega</span>
                    <select
                      value={batteryLocation}
                      onChange={(event) => setBatteryLocation(event.target.value)}
                      aria-label="Elige una localidad para retirar o recibir la batería"
                    >
                      <option value="">Elige una localidad</option>
                      {selectedBattery.locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.location} · {location.inventory} unidades
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <span>Precio</span>
                    <strong>{formatUsd(selectedBattery.price)}</strong>
                  </div>
                  <button
                    type="button"
                    disabled={!batteryLocation}
                    onClick={() => actions.prepareBatteryQuote(selectedBattery.id, 1, batteryLocation)}
                  >
                    <ShoppingCart size={16} /> Cotizar una
                  </button>
                </div>
              </section>
            ) : selectedTire ? state.quote ? (
              <section ref={quoteRef} className={`${styles.detailCard} ${styles.quoteExpanded}`} aria-label="Cotización">
                <div className={styles.quoteProduct}>
                  <span className={styles.family}>Cotización</span>
                  <h2>{selectedTire.name}</h2>
                  <p>{selectedTire.size} · {selectedTire.brand} · Código {selectedTire.code}</p>
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
                    <small>Stock</small>
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
                  <h2>{selectedTire.name}</h2>
                  <p>{selectedTire.size} · {selectedTire.brand} · Código {selectedTire.code}</p>
                </div>
                <div className={styles.quoteArea}>
                  <div>
                    <span>Precio unitario sin IVA</span>
                    <strong>{formatUsd(selectedTire.price.unitWithoutVat)}</strong>
                  </div>
                  <button type="button" onClick={() => actions.prepareQuote(selectedTire.id, 1, "total")}>
                    <ShoppingCart size={16} /> Cotizar una
                  </button>
                </div>
              </section>
            ) : null}

            {state.quote || state.batteryQuote ? (
              <div className={styles.paymentActions}>
                {payment.transaction?.status === "VALIDATED" ? <span><Check size={18} /> Pago aprobado</span> : null}
                <button type="button" disabled={payment.busy} onClick={() => {
                  payment.openDialog();
                  const fulfillment = state.batteryQuote?.location.fulfillment;
                  if (fulfillment && !payment.transaction) void payment.chooseFulfillment(fulfillment);
                }}>
                  <CreditCard size={18} /> {payment.transaction?.status === "VALIDATED" ? "Ver comprobante" : "Pagar con tarjeta"}
                </button>
              </div>
            ) : null}

            {state.activeProductType === "battery" && state.batteries.length ? (
              <div className={styles.productGrid}>
                {state.batteries.map((battery, index) => (
                  <BatteryProductCard
                    key={battery.id}
                    battery={battery}
                    selected={battery.id === state.selectedBatteryId}
                    priority={index === 0}
                    onSelect={() => actions.selectBattery(battery.id)}
                    cardRef={battery.id === state.selectedBatteryId
                      ? (node) => { selectedProductRef.current = node; }
                      : undefined}
                  />
                ))}
              </div>
            ) : state.tires.length ? (
              <div className={styles.productGrid}>
                {state.tires.map((tire, index) => (
                  <TireProductCard
                    key={tire.id}
                    tire={tire}
                    selected={tire.id === state.selectedTireId}
                    priority={index === 0}
                    onSelect={() => actions.selectTire(tire.id)}
                    cardRef={tire.id === state.selectedTireId
                      ? (node) => { selectedProductRef.current = node; }
                      : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.highlights}>
                {highlights === null ? (
                  <div className={styles.emptyState} role="status">
                    <CircleGauge size={34} />
                    <div><strong>Cargando productos destacados.</strong><span>Consultando precios actuales.</span></div>
                  </div>
                ) : highlightCount ? (
                  <>
                    <div className={styles.productGrid}>
                      {highlights.tire ? (
                        <TireProductCard
                          tire={highlights.tire}
                          selected={false}
                          priority
                          onActivate={() => startHighlightedSearch(
                            `Quiero buscar la llanta ${highlights.tire!.name}, medida ${highlights.tire!.size}.`,
                          )}
                        />
                      ) : null}
                      {highlights.battery ? (
                        <BatteryProductCard
                          battery={highlights.battery}
                          selected={false}
                          priority={false}
                          onActivate={() => startHighlightedSearch(
                            `Quiero buscar la batería ${highlights.battery!.name}.`,
                          )}
                        />
                      ) : null}
                    </div>
                    <p className={styles.highlightsNote}>
                      Consulta tu vehículo para verificar compatibilidad y disponibilidad.
                    </p>
                  </>
                ) : (
                  <div className={styles.emptyState}>
                    <CircleGauge size={34} />
                    <div><strong>Describe tu necesidad para consultar el catálogo actual.</strong><span>No se almacena una copia local.</span></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className={`${styles.agentPanel} ${styles[`sheet-${sheet}`]}`} style={sheet !== "closed" && sheetHeight !== null ? { height: `${sheetHeight}dvh`, minHeight: 0, transition: "none" } : undefined} id="agent" aria-label="Asesor PowerAuto">
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
                <strong>Asesor PowerAuto</strong>
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
                aria-label={voice.cameraActive ? "Detener cámara" : "Mostrar el producto con la cámara"}
                aria-pressed={voice.cameraActive}
                title={voice.cameraActive ? "Detener cámara" : "Mostrar producto"}
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
                {voice.active ? <PhoneOff size={18} /> : <Phone size={18} />}
              </button>
              <button className={styles.sheetToggle} type="button" onClick={toggleSheet} aria-label={sheet === "closed" ? "Abrir agente" : "Cerrar agente"} aria-expanded={sheet !== "closed"}>
                {sheet === "closed" ? <Bot size={22} /> : <X size={20} />}
              </button>
            </div>
          </div>

          {voice.cameraStream ? <CameraPreview stream={voice.cameraStream} /> : null}
          {voice.visualEvidence ? (
            <section className={styles.visualEvidence} aria-label="Especificaciones de la batería mostrada">
              <strong>{[voice.visualEvidence.identification.brand, voice.visualEvidence.identification.reference].filter(Boolean).join(" ")}</strong>
              <dl>
                {voice.visualEvidence.specifications.map((spec, index) => (
                  <div key={`${spec.name}-${index}`}>
                    <dt>{({ capacityAh: "Ah", cca: "CCA", ccaStandard: "Estándar CCA", voltageV: "Voltaje", dimensionsMm: "Dimensiones", polarity: "Polaridad", reserveMinutes: "Reserva (min)" } as Record<string, string>)[spec.name] ?? spec.name}</dt>
                    <dd>{spec.value}</dd>
                  </div>
                ))}
              </dl>
              {voice.visualEvidence.sources.filter((source) => /^https?:\/\//.test(source.url)).map((source) => (
                <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              ))}
            </section>
          ) : null}

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
                <p className={styles.thinking}><span>Consultando PowerAuto…</span><span className={styles.thinkingDots} aria-hidden="true"><i /><i /><i /></span></p>
              </div>
            ) : null}
          </div>

          <ClientHandoffPanel
            messages={messages}
            delivery={payment.quote?.delivery}
            vehicle={state.activeProductType === "battery" && state.batteryCriteria
              ? `${state.batteryCriteria.make} ${state.batteryCriteria.model} ${state.batteryCriteria.year}`
              : state.resolvedVehicle
                ? `${state.resolvedVehicle.make} ${state.resolvedVehicle.model} ${state.resolvedVehicle.year}`
                : state.query.trim() || null}
            tire={selectedBattery ? {
              kind: "battery",
              id: selectedBattery.id,
              name: selectedBattery.name,
              image: selectedBattery.image?.split("?", 1)[0] ?? null,
              price: selectedBattery.price,
              quantity: state.batteryQuote?.quantity ?? 1,
              total: state.batteryQuote?.total ?? selectedBattery.price,
            } : selectedTire ? {
              kind: "tire",
              id: selectedTire.id,
              name: selectedTire.name,
              image: selectedTire.image,
              price: selectedTire.price.unitKnownChargesTotal ?? 0,
              quantity: state.quote?.quantity ?? 1,
              total: state.quote?.totalKnownCharges ?? selectedTire.price.unitKnownChargesTotal ?? 0,
            } : null}
            onActiveChange={setHandoffActive}
          />

          {voice.error ? <p className={styles.voiceError} role="status">{voice.error}</p> : null}

          {!handoffActive ? (
            <form className={styles.chatComposer} onSubmit={submitChat} suppressHydrationWarning>
              <input ref={chatInputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={webMcpStatus === "ready" ? "Escribe al asesor…" : "WebMCP requerido"} disabled={webMcpStatus !== "ready" || busy} aria-label="Mensaje para el asesor" suppressHydrationWarning />
              <button disabled={!draft.trim() || busy || webMcpStatus !== "ready"} aria-label="Enviar mensaje"><Send size={18} /></button>
            </form>
          ) : null}
        </aside>
      </div>
      {payment.open ? <PaymentDialog controller={payment} embedded={embedded}
        initialFulfillment={state.batteryQuote?.location.fulfillment}
        productName={selectedBattery?.name ?? selectedTire?.name ?? ""}
        total={state.batteryQuote?.total ?? state.quote?.totalKnownCharges ?? null} /> : null}
    </main>
  );
}
