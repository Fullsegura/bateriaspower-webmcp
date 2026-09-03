"use client";

import Image from "next/image";
import {
  Bot,
  Check,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useCatalog } from "@/features/catalog/catalog-context";
import { ClientHandoffPanel } from "@/features/handoff/client-handoff-panel";
import { useWebMcp } from "@/features/webmcp/use-webmcp";
import { batteries, formatUsd, getBatteryById } from "@/lib/catalog-search";
import { runAgentTurn } from "@/lib/agent-client";
import type { ChatMessage } from "@/types/agent";
import type { Battery } from "@/types/catalog";

import styles from "./search-to-sale-experience.module.css";

function createLocalId() {
  return globalThis.crypto?.randomUUID?.() ?? "local-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hola, soy tu especialista en baterías. Puedo buscar compatibilidad, comparar opciones y preparar una cotización referencial.",
  },
  {
    id: "demo-user",
    role: "user",
    content: "Busco una batería para Toyota Corolla 2018 motor 1.8.",
  },
  {
    id: "demo-agent",
    role: "assistant",
    content:
      "Encontré opciones compatibles del catálogo BateríasPower para Toyota Corolla 2018.",
  },
];

function ProductCard({
  battery,
  selected,
  onSelect,
}: {
  battery: Battery;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`${styles.productCard} ${selected ? styles.selected : ""}`}>
      <div className={styles.productImageWrap}>
        {battery.image ? (
          <Image
            src={battery.image}
            alt={battery.name}
            width={330}
            height={250}
            className={styles.productImage}
            priority
          />
        ) : (
          <div className={styles.productPlaceholder}>
            <Zap size={38} aria-hidden="true" />
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
        <div className={styles.productFooter}>
          <strong>{formatUsd(battery.price)}</strong>
          <button type="button" onClick={onSelect}>
            {selected ? "Ver detalle" : "Seleccionar"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function SearchToSaleExperience() {
  const { state, actions } = useCatalog();
  const webMcpStatus = useWebMcp(actions);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoffActive, setHandoffActive] = useState(false);
  const [sheet, setSheet] = useState<"closed" | "peek" | "half" | "full">("closed");
  const sessionId = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () =>
      state.resultIds
        .map(getBatteryById)
        .filter((item): item is Battery => Boolean(item)),
    [state.resultIds],
  );
  const selected = state.selectedBatteryId
    ? getBatteryById(state.selectedBatteryId)
    : null;

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [busy, messages]);

  async function sendMessage(content: string) {
    const text = content.trim();
    if (!text || busy || handoffActive || webMcpStatus !== "ready") return;

    const userMessage: ChatMessage = {
      id: createLocalId(),
      role: "user",
      content: text,
    };
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
        getUiState: () => state,
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
          content:
            error instanceof Error
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
    setSheet((current) =>
      current === "closed"
        ? "peek"
        : current === "peek"
          ? "half"
          : current === "half"
            ? "full"
            : "peek",
    );
  }

  function toggleSheet() {
    setSheet((current) => current === "closed" ? "half" : "closed");
  }

  return (
    <main className={styles.appShell}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="BateríasPower inicio">
          <span className={styles.logoMark}><Zap size={20} fill="currentColor" /></span>
          <span>Baterías<span>Power</span></span>
        </a>
        <nav className={styles.nav} aria-label="Navegación principal">
          <a href="#top">Inicio</a>
          <a href="#results">Baterías</a>
          <a href="#results">Guías</a>
          <a href="#agent">Soporte</a>
          <a href="#top">Nosotros</a>
        </nav>
        <div className={styles.headerMeta}>
          <span><ShieldCheck size={16} /> Compatibilidad verificada</span>
          <span
            className={styles.headerCart}
            aria-label={state.quote ? "Carrito: 1 artículo" : "Carrito vacío"}
          >
            <ShoppingCart size={18} />
            {state.quote ? <b>1</b> : null}
          </span>
          <button type="button" onClick={actions.reset}>
            <RotateCcw size={15} /> Reiniciar
          </button>
        </div>
      </header>

      <div
        className={styles.workspace + (sheet === "closed" ? " " + styles.agentClosed : "")}
        id="top"
      >
        <section className={styles.storePanel} aria-label="Catálogo de baterías">
          <div className={styles.hero}>
            <span className={styles.eyebrow}>WebMCP conectado</span>
            <h1>¿Qué batería necesita tu vehículo?</h1>
            <p>Describe tu auto; el catálogo y el agente comparten el mismo estado.</p>
            <form
              className={styles.searchForm}
              onSubmit={submitSearch}
              suppressHydrationWarning
            >
              <Search size={21} aria-hidden="true" />
              <input
                value={state.query}
                onChange={(event) => actions.setQuery(event.target.value)}
                placeholder="Ej. Toyota Corolla 2018 motor 1.8"
                aria-label="Describe tu vehículo"
                suppressHydrationWarning
              />
              <button disabled={webMcpStatus !== "ready" || busy || handoffActive}>Buscar</button>
            </form>
            {webMcpStatus === "unsupported" ? (
              <p className={styles.compatibilityNotice} role="status">
                WebMCP nativo no está disponible en este navegador. El catálogo sigue visible,
                pero el agente está deshabilitado.
              </p>
            ) : null}
          </div>

          <div className={styles.resultsSection} id="results">
            <div className={styles.resultsHeading}>
              <div>
                <span>Resultados compatibles</span>
                <h2>
                  {state.criteria
                    ? `${state.criteria.make} ${state.criteria.model} ${state.criteria.year}`
                    : "Catálogo"}
                </h2>
              </div>
              <span>{results.length} opciones</span>
            </div>

            {selected ? (
              <section
                className={styles.detailCard}
                aria-label={state.quote ? "Carrito de cotización" : "Detalle seleccionado"}
              >
                <div>
                  <span className={styles.family}>
                    {state.quote ? "Carrito de cotización" : "Selección actual"}
                  </span>
                  <h2>{selected.name}</h2>
                  <p>
                    {state.quote
                      ? state.quote.quantity + " unidad · Cotización referencial"
                      : selected.polarity + " · " + selected.dimensions}
                  </p>
                </div>
                <div className={styles.quoteArea}>
                  {state.quote ? (
                    <div>
                      <span>Total del carrito</span>
                      <strong>{formatUsd(state.quote.total)}</strong>
                    </div>
                  ) : (
                    <strong>{formatUsd(selected.price)}</strong>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      state.quote
                        ? actions.clearQuote()
                        : actions.prepareQuote(selected.id, 1)
                    }
                  >
                    <ShoppingCart size={16} />
                    {state.quote ? "Quitar" : "Agregar al carrito"}
                  </button>
                </div>
              </section>
            ) : null}

            <div className={styles.productGrid}>
              {(results.length ? results : batteries.slice(0, 2)).map((battery) => (
                <ProductCard
                  key={battery.id}
                  battery={battery}
                  selected={battery.id === state.selectedBatteryId}
                  onSelect={() => actions.selectBattery(battery.id)}
                />
              ))}
            </div>
          </div>
        </section>

        <aside
          className={`${styles.agentPanel} ${styles[`sheet-${sheet}`]}`}
          id="agent"
          aria-label="Agente de baterías"
        >
          <button
            className={styles.sheetHandle}
            type="button"
            onClick={cycleSheet}
            aria-label="Cambiar altura del agente"
          >
            <span />
          </button>
          <div className={styles.agentHeader}>
            <div className={styles.agentIdentity}>
              <span className={styles.agentIcon}><Bot size={22} /></span>
              <div><strong>Agente BateríasPower</strong><span><i /> En línea</span></div>
            </div>
            <button
              className={styles.sheetToggle}
              type="button"
              onClick={toggleSheet}
              aria-label={sheet === "closed" ? "Abrir agente" : "Cerrar agente"}
              aria-expanded={sheet !== "closed"}
            >
              {sheet === "closed" ? <Bot size={22}/> : <X size={20}/>}
            </button>
          </div>

          <div ref={messagesRef} className={styles.messages} aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`${styles.messageRow} ${styles[message.role]}`}
              >
                <span className={styles.avatar}>
                  {message.role === "assistant"
                    ? <Sparkles size={15} />
                    : <UserRound size={15} />}
                </span>
                <p>{message.content}</p>
              </div>
            ))}
            {busy ? (
              <div className={`${styles.messageRow} ${styles.assistant}`}>
                <span className={styles.avatar}><Sparkles size={15} /></span>
                <p className={styles.thinking}>
                  <span>Buscando baterías para tu vehículo…</span>
                  <span className={styles.thinkingDots} aria-hidden="true">
                    <i /><i /><i />
                  </span>
                </p>
              </div>
            ) : null}
          </div>

          <ClientHandoffPanel
            messages={messages}
            vehicle={
              state.criteria
                ? state.criteria.make + " " + state.criteria.model + " " + state.criteria.year + (state.criteria.engine ? " " + state.criteria.engine : "")
                : state.query.trim() || null
            }
            battery={selected ? {
              id: selected.id,
              name: selected.name,
              image: selected.image,
              price: selected.price,
              quantity: state.quote?.quantity ?? 1,
              total: state.quote?.total ?? selected.price,
            } : null}
            onActiveChange={setHandoffActive}
          />

          {!handoffActive ? (
            <form
              className={styles.chatComposer}
              onSubmit={submitChat}
              suppressHydrationWarning
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={webMcpStatus === "ready" ? "Escribe al agente…" : "WebMCP requerido"}
                disabled={webMcpStatus !== "ready" || busy}
                aria-label="Mensaje para el agente"
                suppressHydrationWarning
              />
              <button
                disabled={!draft.trim() || busy || webMcpStatus !== "ready"}
                aria-label="Enviar mensaje"
              >
                <Send size={18} />
              </button>
            </form>
          ) : null}
          <p className={styles.disclaimer}>
            Cotizaciones informativas. No se crean pedidos ni cobros.
          </p>
        </aside>
      </div>
    </main>
  );
}
