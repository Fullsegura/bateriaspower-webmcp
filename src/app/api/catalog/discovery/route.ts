import { NextResponse } from "next/server";

import { discoverCatalog } from "@/lib/catalog-discovery";
import { CatalogInputError, parseCatalogDiscoveryCriteria } from "@/lib/catalog-input";
import { CatalogProvenanceError, requireDiscoveryInputs } from "@/lib/catalog-provenance";
import { recordCatalogDiscovery, requireCatalogSession, requireSessionProduct } from "@/lib/catalog-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const criteria = parseCatalogDiscoveryCriteria(await request.json());
    const session = requireCatalogSession(request);
    requireDiscoveryInputs(session.discoveries, criteria);
    if (criteria.productId) requireSessionProduct(session, criteria.productType, criteria.productId);
    const result = await discoverCatalog(criteria);
    recordCatalogDiscovery(session, result);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CatalogInputError || error instanceof CatalogProvenanceError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "No fue posible descubrir el catálogo." },
      { status: 422 },
    );
  }
}
