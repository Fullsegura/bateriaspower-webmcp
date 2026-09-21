import type { ChatMessage } from "@/types/agent";

export interface VoiceTranscriptUpdate {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export function applyVoiceTranscriptUpdate({
  messages,
  activeMessageId,
  update,
  createId,
}: {
  messages: ChatMessage[];
  activeMessageId: string | null;
  update: VoiceTranscriptUpdate;
  createId: () => string;
}): { messages: ChatMessage[]; activeMessageId: string | null } {
  if (!update.text.trim()) {
    return {
      messages,
      activeMessageId: update.final ? null : activeMessageId,
    };
  }

  const messageId = activeMessageId ?? createId();
  const index = messages.findIndex((message) => message.id === messageId);
  const previousContent = index >= 0 ? messages[index].content : "";
  const content = update.final
    ? update.text.trim()
    : `${previousContent}${update.text}`;
  const nextMessage: ChatMessage = {
    id: messageId,
    role: update.role,
    content,
  };

  if (index < 0) {
    return {
      messages: [...messages, nextMessage],
      activeMessageId: update.final ? null : messageId,
    };
  }

  const nextMessages = [...messages];
  nextMessages[index] = nextMessage;
  return {
    messages: nextMessages,
    activeMessageId: update.final ? null : messageId,
  };
}
