import { describe, expect, it } from "vitest";

import { applyVoiceTranscriptUpdate } from "@/features/voice/transcript-stream";
import type { ChatMessage } from "@/types/agent";

describe("streaming de transcripciones de voz", () => {
  it("actualiza una sola burbuja con fragmentos y la reemplaza con el texto final", () => {
    let messages: ChatMessage[] = [];
    let activeMessageId: string | null = null;
    let nextId = 0;
    const createId = () => `voice-${++nextId}`;

    for (const update of [
      { role: "user" as const, text: "Necesito ", final: false },
      { role: "user" as const, text: "cuatro llantas", final: false },
      { role: "user" as const, text: "Necesito cuatro llantas.", final: true },
    ]) {
      const result = applyVoiceTranscriptUpdate({
        messages,
        activeMessageId,
        update,
        createId,
      });
      messages = result.messages;
      activeMessageId = result.activeMessageId;
    }

    expect(messages).toEqual([{
      id: "voice-1",
      role: "user",
      content: "Necesito cuatro llantas.",
    }]);
    expect(activeMessageId).toBeNull();
  });

  it("crea una nueva burbuja después de finalizar el turno anterior", () => {
    const first = applyVoiceTranscriptUpdate({
      messages: [],
      activeMessageId: null,
      update: { role: "assistant", text: "Primera respuesta", final: true },
      createId: () => "voice-1",
    });
    const second = applyVoiceTranscriptUpdate({
      messages: first.messages,
      activeMessageId: first.activeMessageId,
      update: { role: "assistant", text: "Segunda", final: false },
      createId: () => "voice-2",
    });

    expect(second.messages.map((message) => message.id)).toEqual(["voice-1", "voice-2"]);
    expect(second.activeMessageId).toBe("voice-2");
  });
});
