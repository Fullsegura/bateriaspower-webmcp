import type { CatalogExecutionContext } from "@/types/catalog";

let currentEpoch = 0;
const activeControllers = new Set<AbortController>();

export function getCatalogExecutionEpoch(): number {
  return currentEpoch;
}

export function invalidateCatalogExecutions(nextEpoch?: number): number {
  currentEpoch = Math.max(currentEpoch + 1, nextEpoch ?? 0);
  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
  return currentEpoch;
}

export async function withCatalogExecution<T>(
  operation: (execution: CatalogExecutionContext) => T | Promise<T>,
): Promise<T> {
  const epoch = currentEpoch;
  const controller = new AbortController();
  activeControllers.add(controller);
  try {
    return await operation({
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted && epoch === currentEpoch,
    });
  } finally {
    activeControllers.delete(controller);
  }
}
