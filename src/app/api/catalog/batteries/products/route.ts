import { NextResponse } from "next/server";

import { CatalogProvenanceError } from "@/lib/catalog-provenance";
import { readSessionBatteryCatalog, requireCatalogSession } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const listing = readSessionBatteryCatalog(requireCatalogSession(request));
    return NextResponse.json(listing);
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "No se pudo consultar el catálogo." },
      { status: error instanceof CatalogProvenanceError ? 400 : 500 });
  }
}
