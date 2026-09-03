import { describe, expect, it } from "vitest";

import {
  createLiveKitTextMessage,
  decodeLiveKitTextMessage,
  encodeLiveKitTextMessage,
  LIVEKIT_CHAT_TOPIC,
} from "@/features/handoff/livekit-chat";

describe("chat confiable del handoff LiveKit", () => {
  it("codifica y valida un mensaje recibido", () => {
    const local = createLiveKitTextMessage("  Hola asesor  ", {
      id: "message-1",
      sentAt: 123,
    });

    expect(local).toMatchObject({
      id: "message-1",
      content: "Hola asesor",
      direction: "local",
    });
    expect(decodeLiveKitTextMessage(
      encodeLiveKitTextMessage(local),
      LIVEKIT_CHAT_TOPIC,
    )).toEqual({
      id: "message-1",
      content: "Hola asesor",
      sentAt: 123,
      direction: "remote",
    });
  });

  it("ignora otro topic y payload inválido", () => {
    const payload = new TextEncoder().encode('{"version":1,"content":""}');
    expect(decodeLiveKitTextMessage(payload, "otro-topic")).toBeNull();
    expect(decodeLiveKitTextMessage(payload, LIVEKIT_CHAT_TOPIC)).toBeNull();
  });

  it("rechaza mensajes vacíos o mayores al límite", () => {
    expect(() => createLiveKitTextMessage("   ")).toThrow("Escribe un mensaje.");
    expect(() => createLiveKitTextMessage("x".repeat(1_001)))
      .toThrow("El mensaje es demasiado largo.");
  });
});
