import { NextResponse } from "next/server";

import { isAdvisorAuthorized } from "@/features/handoff/auth";
import {
  createAudioConnection,
  getLiveKitConfig,
} from "@/features/handoff/livekit-server";
import {
  createHandoffCase,
  listHandoffCases,
} from "@/features/handoff/store";
import { parseCreateHandoffInput } from "@/features/handoff/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdvisorAuthorized(request)) {
    return NextResponse.json({ detail: "No autorizado." }, { status: 401 });
  }
  return NextResponse.json({ cases: listHandoffCases() });
}

export async function POST(request: Request) {
  try {
    getLiveKitConfig();
    const input = parseCreateHandoffInput(await request.json());
    const created = createHandoffCase(input);
    const connection = await createAudioConnection({
      roomName: created.roomName,
      identity: created.clientIdentity,
      participantName: input.customerName,
      role: "client",
    });

    return NextResponse.json({
      handoff: created.handoff,
      clientSecret: created.clientSecret,
      connection,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "No fue posible crear el handoff." },
      { status: 400 },
    );
  }
}
