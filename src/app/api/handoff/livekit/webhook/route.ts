import { NextResponse } from "next/server";

import { createWebhookReceiver } from "@/features/handoff/livekit-server";
import {
  endHandoffCaseByParticipant,
  markHandoffConnected,
} from "@/features/handoff/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const event = await createWebhookReceiver().receive(
      rawBody,
      request.headers.get("authorization") || undefined,
    );
    const identity = event.participant?.identity;

    if (event.event === "participant_joined" && identity?.startsWith("advisor-")) {
      markHandoffConnected(identity.slice("advisor-".length));
    }

    if (
      identity &&
      (event.event === "participant_left" ||
        event.event === "participant_connection_aborted")
    ) {
      endHandoffCaseByParticipant(identity);
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ detail: "Webhook LiveKit inválido." }, { status: 401 });
  }
}
