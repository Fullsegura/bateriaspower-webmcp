import { afterEach, describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";

import { createAudioConnection } from "@/features/handoff/livekit-server";

const originalEnv = {
  url: process.env.LIVEKIT_URL,
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
};

afterEach(() => {
  process.env.LIVEKIT_URL = originalEnv.url;
  process.env.LIVEKIT_API_KEY = originalEnv.key;
  process.env.LIVEKIT_API_SECRET = originalEnv.secret;
});

describe("tokens LiveKit del handoff", () => {
  it("limita el token a la sala, micrófono y chat de datos", async () => {
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret-at-least-32-characters";

    const connection = await createAudioConnection({
      roomName: "webmcp-room",
      identity: "client-case",
      participantName: "Cliente",
      role: "client",
    });
    const grants = await new TokenVerifier(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    ).verify(connection.token);

    expect(connection.roomName).toBe("webmcp-room");
    expect(grants.video).toMatchObject({
      room: "webmcp-room",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });
    expect(grants.video?.canPublishSources).toEqual(["microphone"]);
  });
});
