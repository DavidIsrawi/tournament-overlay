import type { NormalizedSet, ServerState } from "../shared/contracts.ts";

export function formatTime(value: string | null): string {
  if (value === null) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function overlayUrl(): string {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:5174/overlay/`;
  }
  return new URL("/overlay/", window.location.origin).toString();
}

export function entrantLabel(set: NormalizedSet): string {
  const [left, right] = set.entrants;
  return `${left?.entrant.name ?? "TBD"} vs ${right?.entrant.name ?? "TBD"}`;
}

export function providerTone(
  state: ServerState,
): "good" | "warn" | "bad" | "muted" {
  switch (state.connection.status) {
    case "fresh":
      return "good";
    case "loading":
    case "stale":
      return "warn";
    case "error":
      return "bad";
    case "idle":
      return "muted";
  }
}
