"use client";

import { AgentAudioVisualizerAura } from "@/components/agents-ui/agent-audio-visualizer-aura";
import type { RemoteAudioTrack } from "livekit-client";
import { useSyncExternalStore } from "react";
import styles from "./call-orb.module.css";

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const readReducedMotion = () => window.matchMedia(motionQuery).matches;
const serverReducedMotion = () => true;

/** Aura observes the remote audio; muting the local microphone does not mute playback. */
export function CallOrb({ muted, audioTrack, speaking = false }: {
  muted: boolean;
  audioTrack?: RemoteAudioTrack;
  speaking?: boolean;
}) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, readReducedMotion, serverReducedMotion);
  return <div className={styles.orb} data-muted={muted} role="img" aria-label={muted ? "Llamada en curso, micrófono silenciado" : "Llamada en curso"}>
    {!reducedMotion && <AgentAudioVisualizerAura
      size="md"
      state={speaking ? "speaking" : "listening"}
      audioTrack={audioTrack}
      themeMode="light"
      color="#1FD5F9"
      colorShift={0.1}
      className={styles.aura}
      aria-hidden="true"
    />}
    {reducedMotion ? <div className={styles.staticAura} aria-hidden="true" /> : null}
  </div>;
}
