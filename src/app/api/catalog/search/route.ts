import { NextResponse } from "next/server";

import { CatalogInputError, parseTireSearchCriteria } from "@/lib/catalog-input";
import { PowerLlantaError, searchTires } from "@/lib/powerllanta";
import { CatalogProvenanceError, requireTireSearchInputs } from "@/lib/catalog-provenance";
import { requireCatalogSession } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const criteria = parseTireSearchCriteria(await request.json());
    const session = requireCatalogSession(request);
    requireTireSearchInputs(session.discoveries, criteria);
    session.products = null;
    session.batteryListing = undefined;
    const result = await searchTires(criteria);
    session.products = { productType: "tire", items: result.tires };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CatalogInputError || error instanceof CatalogProvenanceError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    if (error instanceof PowerLlantaError) {
      return NextResponse.json(
        { detail: error.message, options: error.details },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { detail: "No fue posible consultar el catálogo actual." },
      { status: 500 },
    );
  }
}
