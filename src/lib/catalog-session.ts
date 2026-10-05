import { randomUUID } from "node:crypto";

import { CatalogProvenanceError, upsertDiscovery } from "@/lib/catalog-provenance";
import type { Battery, BatteryCatalogListing, CatalogDiscoveryResult, ProductKind, Tire } from "@/types/catalog";
import { getBatteryCatalogProducts, requireBattery } from "@/lib/battery-catalog";

interface CatalogSession {
  discoveries: CatalogDiscoveryResult[];
  products: { productType: ProductKind; items: Array<Tire | Battery> } | null;
  batteryListing?: { id: string; items: Battery[] };
  expiresAt: number;
}

const STORE_SYMBOL = Symbol.for("powerauto.catalog.sessions");
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 200;

function sessions(): Map<string, CatalogSession> {
  const store = globalThis as typeof globalThis & {
    [STORE_SYMBOL]?: Map<string, CatalogSession>;
  };
  store[STORE_SYMBOL] ??= new Map();
  return store[STORE_SYMBOL];
}

export function createCatalogSession(): string {
  const store = sessions();
  for (const [id, session] of store) {
    if (session.expiresAt <= Date.now()) store.delete(id);
  }
  if (store.size >= MAX_SESSIONS) throw new Error("El catálogo alcanzó su límite de sesiones activas.");
  const id = randomUUID();
  store.set(id, { discoveries: [], products: null, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

export function requireCatalogSession(request: Request): CatalogSession {
  const id = request.headers.get("x-catalog-session");
  const session = id ? sessions().get(id) : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions().delete(id);
    throw new CatalogProvenanceError("La sesión del catálogo no existe o expiró. Reinicia la búsqueda.");
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

export function recordCatalogDiscovery(session: CatalogSession, result: CatalogDiscoveryResult): void {
  session.discoveries = upsertDiscovery(session.discoveries, result);
}

export function requireSessionProduct(session: CatalogSession, productType: ProductKind, id: string): void {
  if (session.products?.productType !== productType ||
      !session.products.items.some((product) => product.id === id)) {
    throw new CatalogProvenanceError("productId no pertenece al resultado actual de la sesión.");
  }
}

export function readSessionBatteryCatalog(session: CatalogSession): BatteryCatalogListing {
  const items = getBatteryCatalogProducts();
  const listingId = randomUUID();
  session.products = null;
  session.batteryListing = { id: listingId, items };
  return {
    listingId,
    products: items.map(({ id, name, capacityAh, cca, polarity, dimensions, reserveCapacityMinutes, price }) =>
      ({ id, name, capacityAh, cca, polarity, dimensions, reserveCapacityMinutes, price })),
    unknownFields: ["voltageV", "ccaStandard"],
    queriedAt: new Date().toISOString(),
  };
}

export function presentSessionBatteryAlternatives(session: CatalogSession, listingId: string, ids: string[]): Battery[] {
  if (!session.batteryListing || session.batteryListing.id !== listingId) {
    throw new CatalogProvenanceError("listingId no pertenece a la consulta vigente de esta sesión.");
  }
  const items = ids.map((id) => requireBattery(session.batteryListing!.items, id));
  session.products = { productType: "battery", items };
  return items;
}
