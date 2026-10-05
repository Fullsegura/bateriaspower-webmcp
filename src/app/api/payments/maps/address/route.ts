import { requireCatalogSession } from "@/lib/catalog-session";
import { parseCoordinates, reverseGeocodeAddress } from "@/lib/payments/delivery-address";
import { isSameOriginRequest } from "@/lib/payments/request-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginRequest(request)) return Response.json({ detail: "Origen no permitido." }, { status: 403, headers });
  try { requireCatalogSession(request); }
  catch { return Response.json({ detail: "La sesión del catálogo no existe o expiró." }, { status: 403, headers }); }
  let point;
  try { point = parseCoordinates(await request.json()); }
  catch { return Response.json({ detail: "Selecciona una ubicación válida en el mapa." }, { status: 400, headers }); }
  try { return Response.json({ address: await reverseGeocodeAddress(point) }, { headers }); }
  catch (error) { return Response.json({ detail: error instanceof Error ? error.message : "No se pudo obtener la dirección." }, { status: 503, headers }); }
}
