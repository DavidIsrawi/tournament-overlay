import { ProviderError } from "../providers/index.ts";
import type { ConnectionState } from "../shared/contracts.ts";

export const IDLE_CONNECTION: ConnectionState = {
  status: "idle",
  message: null,
  lastUpdatedAt: null,
  nextPollAt: null,
  failureCount: 0,
};

export function requestMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The provider request failed.";
}

export function retryDelay(interval: number, failures: number): number {
  return Math.min(interval * 2 ** Math.min(failures, 10), 120_000);
}

export function canRetry(error: unknown): boolean {
  return !(error instanceof ProviderError) || ![
    "missing_token",
    "invalid_event",
    "unknown_provider",
    "event_not_found",
    "set_not_found",
    "phase_group_not_found",
    "persistence_failed",
  ].includes(error.code);
}
