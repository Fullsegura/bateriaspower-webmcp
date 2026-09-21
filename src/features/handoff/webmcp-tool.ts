import { defineTool } from "@nekuda/webmcp-sdk";

export interface AdvisorHandoffResult {
  ok: boolean;
  handoffId?: string;
  status?: string;
  error?: string;
}

type AdvisorHandoffAction = () => Promise<AdvisorHandoffResult>;

let advisorHandoffAction: AdvisorHandoffAction | null = null;

export function bindAdvisorHandoffAction(action: AdvisorHandoffAction): () => void {
  advisorHandoffAction = action;
  return () => {
    if (advisorHandoffAction === action) advisorHandoffAction = null;
  };
}

export const requestAdvisorHandoffTool = defineTool({
  stableKey: "handoff.request",
  name: "request_advisor_handoff",
  title: "Transferir a un asesor",
  description:
    "Transfiere la conversación actual a un asesor humano con su contexto. Úsala cuando el usuario lo solicite explícitamente o acepte una sugerencia de escalamiento.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: { readOnlyHint: false },
  intent: "act",
  async execute() {
    if (!advisorHandoffAction) {
      return { ok: false, error: "El handoff todavía no está disponible." };
    }
    return advisorHandoffAction();
  },
});
