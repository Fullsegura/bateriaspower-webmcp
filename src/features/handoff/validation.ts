import type { ChatMessage } from "@/types/agent";
import type {
  CreateHandoffInput,
  HandoffTireContext,
  HandoffCommerceContext,
} from "@/features/handoff/types";

const MAX_TRANSCRIPT_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 1_000;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Solicitud inválida.");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.slice(0, max) || fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseProductImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim(), "https://webmcp.local");
    if (url.origin === "https://webmcp.local" && url.pathname.startsWith("/products/")) {
      return (url.pathname + url.search).slice(0, 500);
    }
    if (url.origin === "https://erpdurallanta.provedatos.com") {
      return url.toString().slice(0, 500);
    }
    if (
      url.origin === "https://durallanta.com" &&
      url.pathname.startsWith("/durallantaoutlet/productos/")
    ) {
      return url.toString().slice(0, 500);
    }
    return null;
  } catch {
    return null;
  }
}

function parseTranscript(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.slice(-MAX_TRANSCRIPT_MESSAGES).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") return [];
    const content = boundedString(record.content, "", MAX_MESSAGE_LENGTH);
    if (!content) return [];
    return [{
      id: boundedString(record.id, crypto.randomUUID(), 120),
      role: record.role,
      content,
    }];
  });
}

function parseTire(value: unknown): HandoffTireContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = boundedString(record.id, "", 120);
  const name = boundedString(record.name, "", 160);
  if (!id || !name) return null;

  const quantity = Math.min(20, Math.max(1, Math.floor(finiteNumber(record.quantity, 1))));
  const price = Math.max(0, finiteNumber(record.price));
  const total = Math.max(0, finiteNumber(record.total, price * quantity));

  return {
    id,
    name,
    image: parseProductImage(record.image),
    price,
    quantity,
    total,
  };
}

function parseContext(value: unknown): HandoffCommerceContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { vehicle: null, tire: null };
  }
  const record = value as Record<string, unknown>;
  return {
    vehicle: typeof record.vehicle === "string"
      ? boundedString(record.vehicle, "", 180) || null
      : null,
    tire: parseTire(record.tire),
  };
}

export function parseCreateHandoffInput(value: unknown): CreateHandoffInput {
  const record = asObject(value);
  return {
    customerName: boundedString(record.customerName, "Cliente web", 80),
    transcript: parseTranscript(record.transcript),
    context: parseContext(record.context),
  };
}

export function parseCaseAction(value: unknown): {
  action: "status" | "heartbeat" | "accept" | "end";
  clientSecret?: string;
  advisorName?: string;
} {
  const record = asObject(value);
  if (
    record.action !== "status" &&
    record.action !== "heartbeat" &&
    record.action !== "accept" &&
    record.action !== "end"
  ) {
    throw new Error("Acción inválida.");
  }

  return {
    action: record.action,
    clientSecret:
      typeof record.clientSecret === "string" ? record.clientSecret : undefined,
    advisorName:
      typeof record.advisorName === "string"
        ? boundedString(record.advisorName, "Asesor", 80)
        : undefined,
  };
}
