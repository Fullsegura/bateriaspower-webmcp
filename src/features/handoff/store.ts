import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  CreateHandoffInput,
  PublicHandoffCase,
} from "@/features/handoff/types";

interface StoredHandoffCase extends PublicHandoffCase {
  tenantId: string;
  roomName: string;
  clientIdentity: string;
  advisorIdentity: string;
  clientSecretHash: string;
  lastClientHeartbeatAt: number;
  advisorName: string | null;
}

interface HandoffStore {
  cases: Map<string, StoredHandoffCase>;
}

const STORE_SYMBOL = Symbol.for("bateriaspower.handoff.store");
const CLIENT_LEASE_MS = 45_000;
const MAX_CASES = 100;

function getStore(): HandoffStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_SYMBOL]?: HandoffStore;
  };
  globalStore[STORE_SYMBOL] ??= { cases: new Map() };
  return globalStore[STORE_SYMBOL];
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function secretMatches(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(hashSecret(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return candidateHash.length === expected.length &&
    timingSafeEqual(candidateHash, expected);
}

function publicCase(item: StoredHandoffCase): PublicHandoffCase {
  return {
    id: item.id,
    customerName: item.customerName,
    status: item.status,
    transcript: item.transcript,
    context: item.context,
    createdAt: item.createdAt,
    acceptedAt: item.acceptedAt,
    connectedAt: item.connectedAt,
    endedAt: item.endedAt,
    endedBy: item.endedBy,
  };
}

function endStoredCase(
  item: StoredHandoffCase,
  endedBy: NonNullable<PublicHandoffCase["endedBy"]>,
): PublicHandoffCase {
  if (item.status !== "ended") {
    item.status = "ended";
    item.endedAt = new Date().toISOString();
    item.endedBy = endedBy;
  }
  return publicCase(item);
}

function sweepExpiredCases(now = Date.now()) {
  for (const item of getStore().cases.values()) {
    if (
      item.status !== "ended" &&
      now - item.lastClientHeartbeatAt > CLIENT_LEASE_MS
    ) {
      endStoredCase(item, "timeout");
    }
  }
}

function trimStore() {
  const store = getStore();
  if (store.cases.size < MAX_CASES) return;

  const ended = [...store.cases.values()]
    .filter((item) => item.status === "ended")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const item of ended) {
    store.cases.delete(item.id);
    if (store.cases.size < MAX_CASES) return;
  }
}

export function resolveTenantId(): string {
  return process.env.WEBMCP_TENANT_ID?.trim() || "baterias-power-demo";
}

export function createHandoffCase(input: CreateHandoffInput): {
  handoff: PublicHandoffCase;
  clientSecret: string;
  roomName: string;
  clientIdentity: string;
} {
  sweepExpiredCases();
  trimStore();

  const id = randomUUID();
  const tenantId = resolveTenantId();
  const tenantSlug = tenantId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const clientSecret = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const item: StoredHandoffCase = {
    id,
    tenantId,
    roomName: "webmcp-" + tenantSlug + "-" + id,
    clientIdentity: "client-" + id,
    advisorIdentity: "advisor-" + id,
    clientSecretHash: hashSecret(clientSecret),
    lastClientHeartbeatAt: Date.now(),
    advisorName: null,
    customerName: input.customerName,
    status: "waiting",
    transcript: input.transcript,
    context: input.context,
    createdAt: now,
    acceptedAt: null,
    connectedAt: null,
    endedAt: null,
    endedBy: null,
  };

  getStore().cases.set(id, item);
  return {
    handoff: publicCase(item),
    clientSecret,
    roomName: item.roomName,
    clientIdentity: item.clientIdentity,
  };
}

function requireCase(id: string): StoredHandoffCase {
  sweepExpiredCases();
  const item = getStore().cases.get(id);
  if (!item) throw new Error("Caso no encontrado.");
  return item;
}

function requireClientCase(id: string, clientSecret: string): StoredHandoffCase {
  const item = requireCase(id);
  if (!clientSecret || !secretMatches(clientSecret, item.clientSecretHash)) {
    throw new Error("Credencial de cliente inválida.");
  }
  return item;
}

export function listHandoffCases(): PublicHandoffCase[] {
  sweepExpiredCases();
  return [...getStore().cases.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(publicCase);
}

export function getHandoffCaseForAdvisor(id: string): {
  handoff: PublicHandoffCase;
  roomName: string;
  advisorIdentity: string;
} {
  const item = requireCase(id);
  return {
    handoff: publicCase(item),
    roomName: item.roomName,
    advisorIdentity: item.advisorIdentity,
  };
}

export function getHandoffCaseForClient(
  id: string,
  clientSecret: string,
): PublicHandoffCase {
  return publicCase(requireClientCase(id, clientSecret));
}

export function heartbeatHandoffCase(
  id: string,
  clientSecret: string,
): PublicHandoffCase {
  const item = requireClientCase(id, clientSecret);
  if (item.status !== "ended") item.lastClientHeartbeatAt = Date.now();
  return publicCase(item);
}

export function acceptHandoffCase(
  id: string,
  advisorName: string,
): PublicHandoffCase {
  const item = requireCase(id);
  if (item.status !== "waiting") {
    throw new Error("El caso ya no está disponible.");
  }
  item.status = "accepted";
  item.advisorName = advisorName;
  item.acceptedAt = new Date().toISOString();
  return publicCase(item);
}

export function markHandoffConnected(id: string): PublicHandoffCase {
  const item = requireCase(id);
  if (item.status === "accepted") {
    item.status = "connected";
    item.connectedAt = new Date().toISOString();
  }
  return publicCase(item);
}

export function endHandoffCaseByClient(
  id: string,
  clientSecret: string,
): PublicHandoffCase {
  return endStoredCase(requireClientCase(id, clientSecret), "client");
}

export function endHandoffCaseByAdvisor(id: string): PublicHandoffCase {
  return endStoredCase(requireCase(id), "advisor");
}

export function endHandoffCaseByParticipant(identity: string): PublicHandoffCase | null {
  const prefix = identity.startsWith("client-")
    ? "client-"
    : identity.startsWith("advisor-")
      ? "advisor-"
      : null;
  if (!prefix) return null;

  const item = getStore().cases.get(identity.slice(prefix.length));
  return item ? endStoredCase(item, "livekit") : null;
}

export function resetHandoffStoreForTests() {
  getStore().cases.clear();
}

export const handoffStoreConfig = {
  clientLeaseMs: CLIENT_LEASE_MS,
};
