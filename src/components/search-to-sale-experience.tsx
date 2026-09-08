"use client";

import Image from "next/image";
import {
  Bot,
  Check,
  CircleGauge,
  MapPin,
  PackageCheck,
  RotateCcw,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { useCatalog } from "@/features/catalog/catalog-context";
import { ClientHandoffPanel } from "@/features/handoff/client-handoff-panel";
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
  const webMcpStatus = useWebMcp(actions, state.tires.length > 0);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoffActive, setHandoffActive] = useState(false);
  const [sheet, setSheet] = useState<"closed" | "peek" | "half" | "full">("closed");
  const sessionId = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const quoteRef = useRef<HTMLElement>(null);
  const initialQuerySubmitted = useRef(false);
  const stateRef = useRef(state);

  const selected = state.selectedTireId ? getTireById(state.tires, state.selectedTireId) : null;
  const queriedAt = formatQueryTime(state.queriedAt);
  const cartQuantity = state.quote?.quantity ?? 0;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    setSheet((current) => current === "closed" ? "peek" : current === "peek" ? "half" : current === "half" ? "full" : "peek");
  }

  function toggleSheet() {
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
          <span><PackageCheck size={16} /> Fuente pública Durallanta</span>
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
                <span>{queriedAt ? `Consultado ${queriedAt} · Durallanta` : "Resultados en tiempo real"}</span>
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

        <aside className={`${styles.agentPanel} ${styles[`sheet-${sheet}`]}`} id="agent" aria-label="Agente de llantas">
          <button className={styles.sheetHandle} type="button" onClick={cycleSheet} aria-label="Cambiar altura del agente"><span /></button>
          <div className={styles.agentHeader}>
            <div className={styles.agentIdentity}>
              <span className={styles.agentIcon}><Bot size={22} /></span>
              <div><strong>Asesor de llantas</strong><span><i /> En línea</span></div>
            </div>
            <button className={styles.sheetToggle} type="button" onClick={toggleSheet} aria-label={sheet === "closed" ? "Abrir agente" : "Cerrar agente"} aria-expanded={sheet !== "closed"}>
              {sheet === "closed" ? <Bot size={22} /> : <X size={20} />}
            </button>
          </div>

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
                <p className={styles.thinking}><span>Consultando Durallanta…</span><span className={styles.thinkingDots} aria-hidden="true"><i /><i /><i /></span></p>
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
