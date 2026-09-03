import type { AgentAction, AgentRequest, ChatMessage } from "@/types/agent";
import type { CatalogState } from "@/types/catalog";

const MAX_TOOL_STEPS = 6;

export function normalizeInputSchema(inputSchema: unknown): object | undefined {
  if (inputSchema === undefined || inputSchema === null) {
    return undefined;
  }

  const schema =
    typeof inputSchema === "string" ? JSON.parse(inputSchema) : inputSchema;

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("WebMCP devolvió un inputSchema no válido.");
  }

  return schema;
}

export function serializeToolArguments(input: Record<string, unknown>): string {
  return JSON.stringify(input);
}

async function requestAgent(
  payload: AgentRequest,
  signal?: AbortSignal,
): Promise<AgentAction> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "El agente no está disponible.");
  }
  return (await response.json()) as AgentAction;
}

export async function runAgentTurn({
  sessionId,
  messages,
  getUiState,
  signal,
}: {
  sessionId: string;
  messages: ChatMessage[];
  getUiState: () => CatalogState;
  signal?: AbortSignal;
}): Promise<string> {
  const modelContext = document.modelContext;
  if (!modelContext) {
    throw new Error("Este navegador no ofrece WebMCP nativo.");
  }

  const registeredTools = await modelContext.getTools();
  const tools = registeredTools.map(
    ({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: normalizeInputSchema(inputSchema),
      annotations,
    }),
  );
  let toolResult: AgentRequest["toolResult"];

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const action = await requestAgent(
      { sessionId, messages, tools, uiState: getUiState(), toolResult },
      signal,
    );
    if (action.kind === "message") {
      return action.message;
    }

    const tool = registeredTools.find(({ name }) => name === action.toolName);
    if (!tool) {
      throw new Error(`El agente solicitó una herramienta no registrada: ${action.toolName}`);
    }
    const result = await modelContext.executeTool(
      tool,
      serializeToolArguments(action.arguments),
      { signal },
    );
    toolResult = { toolName: action.toolName, result };
  }

  throw new Error("El agente excedió el límite seguro de herramientas.");
}
