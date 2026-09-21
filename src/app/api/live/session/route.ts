import { NextResponse } from "next/server";

import { issueLiveSessionToken } from "@/lib/live-session-token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.LIVE_SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { detail: "El asistente de voz no está configurado." },
      { status: 503 },
    );
  }

  let sessionId: string | undefined;
  try {
    const body = await request.json() as { sessionId?: unknown };
    if (body.sessionId !== undefined && typeof body.sessionId !== "string") {
      return NextResponse.json({ detail: "sessionId no es válido." }, { status: 400 });
    }
    sessionId = body.sessionId;
  } catch {
    sessionId = undefined;
  }

  try {
    return NextResponse.json(issueLiveSessionToken({ secret, sessionId }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "No se pudo crear la sesión." },
      { status: 400 },
    );
  }
}
