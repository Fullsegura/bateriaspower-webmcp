"use client";

import { useCallback, useEffect, useRef } from "react";

import type { HandoffStatus, PublicHandoffCase } from "@/features/handoff/types";

const RING_INTERVAL_MS = 2_800;

export function shouldRingClient(
  status: HandoffStatus | undefined,
  remoteParticipantCount: number,
): boolean {
  return Boolean(status && status !== "ended" && remoteParticipantCount === 0);
}

export function hasWaitingAdvisorCall(cases: PublicHandoffCase[]): boolean {
  return cases.some((item) => item.status === "waiting");
}

export function didCallEnd(
  previous: HandoffStatus | null | undefined,
  current: HandoffStatus | null | undefined,
): boolean {
  return Boolean(previous && previous !== "ended" && current === "ended");
}

export function useForegroundCallSounds() {
  const contextRef = useRef<AudioContext | null>(null);
  const ringingRef = useRef(false);
  const ringTimerRef = useRef<number | null>(null);
  const oscillatorsRef = useRef<Set<OscillatorNode>>(new Set());

  const ensureContext = useCallback(async () => {
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    if (context.state === "suspended") await context.resume();
    return context;
  }, []);

  const stopCurrentTone = useCallback(() => {
    for (const oscillator of oscillatorsRef.current) {
      try {
        oscillator.stop();
      } catch {
        // The tone already ended naturally.
      }
      oscillator.disconnect();
    }
    oscillatorsRef.current.clear();
  }, []);

  const playRingPulse = useCallback((context: AudioContext) => {
    stopCurrentTone();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.02);
    gain.gain.setValueAtTime(0.055, context.currentTime + 0.78);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.85);
    gain.connect(context.destination);

    for (const frequency of [440, 480]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillatorsRef.current.add(oscillator);
      oscillator.onended = () => oscillatorsRef.current.delete(oscillator);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.86);
    }
  }, [stopCurrentTone]);

  const unlock = useCallback(() => {
    void ensureContext();
  }, [ensureContext]);

  const stopRinging = useCallback(() => {
    ringingRef.current = false;
    if (ringTimerRef.current !== null) {
      window.clearInterval(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    stopCurrentTone();
  }, [stopCurrentTone]);

  const startRinging = useCallback(() => {
    if (ringingRef.current) return;
    ringingRef.current = true;
    void ensureContext().then((context) => {
      if (!ringingRef.current) return;
      playRingPulse(context);
      ringTimerRef.current = window.setInterval(() => {
        if (ringingRef.current) playRingPulse(context);
      }, RING_INTERVAL_MS);
    }).catch(() => {
      ringingRef.current = false;
    });
  }, [ensureContext, playRingPulse]);

  const playHangup = useCallback(() => {
    stopRinging();
    void ensureContext().then((context) => {
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(420, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(180, context.currentTime + 0.34);
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.36);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillatorsRef.current.add(oscillator);
      oscillator.onended = () => oscillatorsRef.current.delete(oscillator);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.37);
    }).catch(() => undefined);
  }, [ensureContext, stopRinging]);

  useEffect(() => {
    const oscillators = oscillatorsRef.current;
    return () => {
      if (ringTimerRef.current !== null) window.clearInterval(ringTimerRef.current);
      for (const oscillator of oscillators) {
        try {
          oscillator.stop();
        } catch {
          // The tone already ended naturally.
        }
      }
      oscillators.clear();
      void contextRef.current?.close();
      contextRef.current = null;
    };
  }, []);

  return { playHangup, startRinging, stopRinging, unlock };
}
