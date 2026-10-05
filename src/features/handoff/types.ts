import type { ChatMessage } from "@/types/agent";
import type { ProductKind } from "@/types/catalog";

export type HandoffStatus =
  | "waiting"
  | "accepted"
  | "connected"
  | "ended";

export interface HandoffTireContext {
  kind?: ProductKind;
  id: string;
  name: string;
  image: string | null;
  price: number;
  quantity: number;
  total: number;
}

export interface HandoffCommerceContext {
  vehicle: string | null;
  tire: HandoffTireContext | null;
  delivery?: import("@/types/payment").DeliveryLocation;
}

export interface CreateHandoffInput {
  customerName: string;
  transcript: ChatMessage[];
  context: HandoffCommerceContext;
}

export interface PublicHandoffCase {
  id: string;
  customerName: string;
  status: HandoffStatus;
  transcript: ChatMessage[];
  context: HandoffCommerceContext;
  createdAt: string;
  acceptedAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  endedBy: "client" | "advisor" | "timeout" | "livekit" | null;
}

export interface LiveKitConnection {
  url: string;
  token: string;
  roomName: string;
}

export interface CreateHandoffResponse {
  handoff: PublicHandoffCase;
  clientSecret: string;
  connection: LiveKitConnection;
}
