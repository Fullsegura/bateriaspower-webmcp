import type { CatalogState } from "@/types/catalog";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface SerializableTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: object;
  annotations?: WebMCP.ToolAnnotations;
}

export type AgentAction =
  | { kind: "message"; message: string }
  | {
      kind: "tool_call";
      toolName: string;
      arguments: Record<string, unknown>;
      message?: string;
    };

export interface AgentRequest {
  sessionId: string;
  messages: ChatMessage[];
  tools: SerializableTool[];
  uiState: CatalogState;
  toolResult?: { toolName: string; result: unknown };
}
