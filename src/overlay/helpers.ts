import type { OverlayView } from "../shared/contracts.ts";

export function overlayFreshnessLabel(
  connected: boolean,
  status: OverlayView["status"],
): string | null {
  if (!connected) {
    return "Server reconnecting";
  }
  return status === "stale" || status === "error"
    ? "Tournament data stale"
    : null;
}
