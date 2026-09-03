import { NextResponse } from "next/server";

import { isAdvisorAuthorized } from "@/features/handoff/auth";
import { createAudioConnection } from "@/features/handoff/livekit-server";
import {
  acceptHandoffCase,
  endHandoffCaseByAdvisor,
  endHandoffCaseByClient,
  getHandoffCaseForAdvisor,
  getHandoffCaseForClient,
  heartbeatHandoffCase,
} from "@/features/handoff/store";
import { parseCaseAction } from "@/features/handoff/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ caseId: string }> };

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Solicitud inválida.";
  const status = message.includes("no encontrado")
    ? 404
    : message.includes("Credencial") || message.includes("autorizado")
      ? 401
      : message.includes("disponible")
        ? 409
        : 400;
  return NextResponse.json({ detail: message }, { status });
}

export async function POST(request: Request, context: Context) {
  try {
    const { caseId } = await context.params;
    const input = parseCaseAction(await request.json());
    const advisorAuthorized = isAdvisorAuthorized(request);

    if (input.action === "accept") {
      if (!advisorAuthorized) {
        return NextResponse.json({ detail: "No autorizado." }, { status: 401 });
      }
      const existing = getHandoffCaseForAdvisor(caseId);
      if (existing.handoff.status === "ended") {
        throw new Error("El caso ya no está disponible.");
      }
      const advisorName = input.advisorName || "Asesor BateríasPower";
      const connection = await createAudioConnection({
        roomName: existing.roomName,
        identity: existing.advisorIdentity,
        participantName: advisorName,
        role: "advisor",
      });
      const handoff = existing.handoff.status === "waiting"
        ? acceptHandoffCase(caseId, advisorName)
        : existing.handoff;
      return NextResponse.json({ handoff, connection });
    }

    if (input.action === "end" && advisorAuthorized) {
      return NextResponse.json({ handoff: endHandoffCaseByAdvisor(caseId) });
    }

    if (!input.clientSecret) {
      return NextResponse.json(
        { detail: "Credencial de cliente requerida." },
        { status: 401 },
      );
    }

    if (input.action === "status") {
      return NextResponse.json({
        handoff: getHandoffCaseForClient(caseId, input.clientSecret),
      });
    }

    if (input.action === "heartbeat") {
      return NextResponse.json({
        handoff: heartbeatHandoffCase(caseId, input.clientSecret),
      });
    }

    return NextResponse.json({
      handoff: endHandoffCaseByClient(caseId, input.clientSecret),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
