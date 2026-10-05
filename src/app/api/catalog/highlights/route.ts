import { NextResponse } from "next/server";

import { getCatalogPreviewBattery } from "@/lib/battery-catalog";
import { searchTires } from "@/lib/powerllanta";
import type { Tire } from "@/types/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function selectPreviewTire(tires: Tire[]): Tire | null {
  return tires.find((tire) => tire.image && tire.price.status === "available")
    ?? tires.find((tire) => tire.price.status === "available")
    ?? tires[0]
    ?? null;
}

export async function GET() {
  const battery = getCatalogPreviewBattery();

  try {
    const result = await searchTires({
      mode: "measure",
      category: "01",
      quantity: 1,
    });
    return NextResponse.json(
      { tire: selectPreviewTire(result.tires), battery },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { tire: null, battery },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
