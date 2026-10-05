import { NextResponse } from "next/server";
import { createCatalogSession } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json({ sessionId: createCatalogSession() }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Sesión no disponible." },
      { status: 503 });
  }
}
