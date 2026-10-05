import { NextResponse } from "next/server";

import { BatteryCatalogError, searchVehicleBatteries } from "@/lib/battery-catalog";
import { BatteryInputError, parseBatterySearchCriteria } from "@/lib/battery-input";
import { CatalogProvenanceError, requireBatterySearchInputs } from "@/lib/catalog-provenance";
import { requireCatalogSession } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const criteria = parseBatterySearchCriteria(await request.json());
    const session = requireCatalogSession(request);
    requireBatterySearchInputs(session.discoveries, criteria);
    session.products = null;
    session.batteryListing = undefined;
    const result = await searchVehicleBatteries(criteria);
    session.products = { productType: "battery", items: result.batteries };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BatteryInputError || error instanceof CatalogProvenanceError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    if (error instanceof BatteryCatalogError) {
      return NextResponse.json(
        { detail: error.message, options: error.details },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { detail: "No fue posible consultar el catálogo de baterías." },
      { status: 500 },
    );
  }
}
