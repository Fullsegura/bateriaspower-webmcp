import { NextResponse } from "next/server";

import { parseBatteryAlternatives } from "@/lib/battery-input";
import { presentSessionBatteryAlternatives, requireCatalogSession } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { listingId, batteryIds } = parseBatteryAlternatives(await request.json());
    const batteries = presentSessionBatteryAlternatives(requireCatalogSession(request), listingId, batteryIds);
    return NextResponse.json({ batteries, resolvedVehicle: null, queriedAt: new Date().toISOString(),
      source: "Catálogo PowerAuto", note: "Comparación de especificaciones." });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "No se pudieron presentar las alternativas." },
      { status: 400 });
  }
}
