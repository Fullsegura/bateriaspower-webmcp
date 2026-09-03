export const LIVEKIT_CHAT_TOPIC = "webmcp.chat.v1";
export const LIVEKIT_CHAT_MAX_LENGTH = 1_000;

interface WireChatMessage {
  version: 1;
  id: string;
  content: string;
  sentAt: number;
}

export interface LiveKitTextMessage {
  id: string;
  content: string;
  sentAt: number;
  direction: "local" | "remote";
}

export function createLiveKitTextMessage(
  content: string,
  options: { id?: string; sentAt?: number } = {},
): LiveKitTextMessage {
  const normalized = content.trim();
  if (!normalized) throw new Error("Escribe un mensaje.");
  if (normalized.length > LIVEKIT_CHAT_MAX_LENGTH) {
    throw new Error("El mensaje es demasiado largo.");
  }

  return {
    id: options.id || crypto.randomUUID(),
    content: normalized,
    sentAt: options.sentAt ?? Date.now(),
    direction: "local",
  };
}

export function encodeLiveKitTextMessage(message: LiveKitTextMessage): Uint8Array {
  const wireMessage: WireChatMessage = {
    version: 1,
    id: message.id,
    content: message.content,
    sentAt: message.sentAt,
  };
  return new TextEncoder().encode(JSON.stringify(wireMessage));
}

export function decodeLiveKitTextMessage(
  payload: Uint8Array,
  topic: string | undefined,
): LiveKitTextMessage | null {
  if (topic !== LIVEKIT_CHAT_TOPIC || payload.byteLength > 4_096) return null;

  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Partial<WireChatMessage>;
    if (
      value.version !== 1 ||
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 120 ||
      typeof value.content !== "string" ||
      !value.content.trim() ||
      value.content.length > LIVEKIT_CHAT_MAX_LENGTH ||
      typeof value.sentAt !== "number" ||
      !Number.isFinite(value.sentAt)
    ) {
      return null;
    }

    return {
      id: value.id,
      content: value.content.trim(),
      sentAt: value.sentAt,
      direction: "remote",
    };
  } catch {
    return null;
  }
}
