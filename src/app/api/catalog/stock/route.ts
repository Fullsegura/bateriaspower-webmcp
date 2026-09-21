import { NextResponse } from "next/server";

import { CatalogInputError, parseStockCriteria } from "@/lib/catalog-input";
import { PowerLlantaError, summarizeTireStock } from "@/lib/powerllanta";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const criteria = parseStockCriteria(await request.json());
    return NextResponse.json(await summarizeTireStock(criteria));
  } catch (error) {
    if (error instanceof CatalogInputError) {
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
