"use client";

import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createLiveKitTextMessage,
  decodeLiveKitTextMessage,
  encodeLiveKitTextMessage,
  LIVEKIT_CHAT_TOPIC,
  type LiveKitTextMessage,
} from "@/features/handoff/livekit-chat";
import type { LiveKitConnection } from "@/features/handoff/types";

export type AudioConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export function useLiveKitAudio() {
  const roomRef = useRef<Room | null>(null);
  const audioRootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<AudioConnectionState>("idle");
  const [muted, setMuted] = useState(false);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<RemoteAudioTrack>();
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [textMessages, setTextMessages] = useState<LiveKitTextMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const clearAudio = useCallback(() => {
    audioRootRef.current?.replaceChildren();
    setRemoteAudioTrack(undefined);
    setRemoteSpeaking(false);
  }, []);

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    clearAudio();
    setMuted(false);
    setRemoteParticipantCount(0);
    setState("ended");
  }, [clearAudio]);

  const connect = useCallback(async (connection: LiveKitConnection) => {
    if (roomRef.current) await disconnect();

    setError(null);
    setTextMessages([]);
    setState("connecting");
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;

    const updateRemoteCount = () => {
      setRemoteParticipantCount(room.remoteParticipants.size);
    };
    const attachAudio = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      void publication;
      void participant;
      if (track.kind !== Track.Kind.Audio) return;
      setRemoteAudioTrack(track as RemoteAudioTrack);
      const element = track.attach();
      element.autoplay = true;
      element.setAttribute("playsinline", "");
      audioRootRef.current?.appendChild(element);
    };
    const detachAudio = (track: RemoteTrack) => {
      for (const element of track.detach()) element.remove();
      setRemoteAudioTrack((current) => current === track ? undefined : current);
    };

    room
      .on(RoomEvent.TrackSubscribed, attachAudio)
      .on(RoomEvent.TrackUnsubscribed, detachAudio)
      .on(RoomEvent.ParticipantConnected, updateRemoteCount)
      .on(RoomEvent.ParticipantDisconnected, updateRemoteCount)
      .on(RoomEvent.ActiveSpeakersChanged, (participants) => {
        setRemoteSpeaking(participants.some((participant) => !participant.isLocal));
      })
      // UNVERIFIED_MCP: Checked against docs.livekit.io and livekit-client 2.20 types.
      .on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
        void participant;
        void kind;
        const message = decodeLiveKitTextMessage(payload, topic);
        if (!message) return;
        setTextMessages((current) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message],
        );
      })
      .on(RoomEvent.Disconnected, () => {
        clearAudio();
        setRemoteParticipantCount(0);
        setState("ended");
      });

    try {
      await room.connect(connection.url, connection.token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      updateRemoteCount();
      setMuted(false);
      setState("connected");
    } catch (caught) {
      await room.disconnect();
      roomRef.current = null;
      clearAudio();
      const message = caught instanceof Error
        ? caught.message
        : "No fue posible conectar el audio.";
      setError(message);
      setState("error");
      throw caught;
    }
  }, [clearAudio, disconnect]);

  const sendText = useCallback(async (content: string) => {
    const room = roomRef.current;
    if (!room) throw new Error("La llamada todavía no está conectada.");
    if (room.remoteParticipants.size === 0) {
      throw new Error("Espera a que el otro participante se conecte.");
    }

    const message = createLiveKitTextMessage(content);
    // UNVERIFIED_MCP: Checked against docs.livekit.io and livekit-client 2.20 types.
    await room.localParticipant.publishData(
      encodeLiveKitTextMessage(message),
      { reliable: true, topic: LIVEKIT_CHAT_TOPIC },
    );
    setTextMessages((current) => [...current, message]);
    return message;
  }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  }, [muted]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
      clearAudio();
    };
  }, [clearAudio]);

  return {
    audioRootRef,
    connect,
    disconnect,
    error,
    muted,
    remoteParticipantCount,
    remoteAudioTrack,
    remoteSpeaking,
    sendText,
    state,
    textMessages,
    toggleMute,
  };
}
