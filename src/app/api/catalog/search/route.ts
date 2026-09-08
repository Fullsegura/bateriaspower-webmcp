import { NextResponse } from "next/server";

import { CatalogInputError, parseTireSearchCriteria } from "@/lib/catalog-input";
import { DurallantaError, searchTires } from "@/lib/durallanta";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const criteria = parseTireSearchCriteria(await request.json());
    return NextResponse.json(await searchTires(criteria));
  } catch (error) {
    if (error instanceof CatalogInputError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    if (error instanceof DurallantaError) {
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
