import { NextResponse } from "next/server";

import { CatalogInputError, parseStockCriteria } from "@/lib/catalog-input";
import { PowerLlantaError, summarizeTireStock } from "@/lib/powerllanta";
import { CatalogProvenanceError, requireStockInputs } from "@/lib/catalog-provenance";
import { requireCatalogSession } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const criteria = parseStockCriteria(await request.json());
    requireStockInputs(requireCatalogSession(request).discoveries, criteria);
    return NextResponse.json(await summarizeTireStock(criteria));
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
      { detail: "No fue posible consultar el stock actual." },
      { status: 500 },
    );
  }
}
