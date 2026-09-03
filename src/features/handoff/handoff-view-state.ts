import type { HandoffStatus } from "@/features/handoff/types";

export function isClientHandoffVisible(
  status: HandoffStatus | null | undefined,
): boolean {
  return Boolean(status && status !== "ended");
}
