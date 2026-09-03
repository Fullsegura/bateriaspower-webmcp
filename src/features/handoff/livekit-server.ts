import {
  AccessToken,
  TrackSource,
  WebhookReceiver,
} from "livekit-server-sdk";

import type { LiveKitConnection } from "@/features/handoff/types";

interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export function getLiveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      "LiveKit no está configurado. Define LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET.",
    );
  }

  return { url, apiKey, apiSecret };
}

export async function createAudioConnection(input: {
  roomName: string;
  identity: string;
  participantName: string;
  role: "client" | "advisor";
}): Promise<LiveKitConnection> {
  const config = getLiveKitConfig();
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.participantName,
    ttl: "10m",
    metadata: JSON.stringify({ role: input.role }),
  });

  token.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
  });

  return {
    url: config.url,
    token: await token.toJwt(),
    roomName: input.roomName,
  };
}

export function createWebhookReceiver(): WebhookReceiver {
  const config = getLiveKitConfig();
  return new WebhookReceiver(config.apiKey, config.apiSecret);
}
