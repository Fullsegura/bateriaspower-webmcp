import type { ChatMessage } from "@/types/agent";

export type HandoffStatus =
  | "waiting"
  | "accepted"
  | "connected"
  | "ended";

export interface HandoffBatteryContext {
  id: string;
  name: string;
  image: string | null;
  price: number;
  quantity: number;
  total: number;
}

export interface HandoffCommerceContext {
  vehicle: string | null;
  battery: HandoffBatteryContext | null;
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
