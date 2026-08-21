import type {
  ConnectionState,
  NormalizedSet,
} from "../shared/contracts.ts";

export type SetFilter = "pending" | "completed";
export type StatusTone = "good" | "warn" | "bad" | "muted";

export interface VisibleRound {
  readonly name: string;
  readonly order: number;
  readonly sets: readonly NormalizedSet[];
}

export interface ConnectionNotice {
  readonly canRetry: boolean;
  readonly message: string;
  readonly title: string;
  readonly tone: StatusTone;
  readonly variant: "error" | "warning";
}

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

function entrantLabel(set: NormalizedSet): string {
  const [left, right] = set.entrants;
  return `${left?.entrant.name ?? "TBD"} vs ${right?.entrant.name ?? "TBD"}`;
}

function providerTone(status: ConnectionState["status"]): StatusTone {
  switch (status) {
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

export function buildVisibleRounds(
  sets: readonly NormalizedSet[],
  query: string,
  filter: SetFilter,
): readonly VisibleRound[] {
  const normalizedQuery = query.trim().toLowerCase();
  const byRound = new Map<
    string,
    { readonly order: number; sets: NormalizedSet[] }
  >();

  for (const set of sets) {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      `${set.identifier} ${set.round.name} ${entrantLabel(set)}`
        .toLowerCase()
        .includes(normalizedQuery);
    const matchesFilter =
      filter === "pending"
        ? set.state === "pending" || set.state === "active"
        : set.state === "completed";
    if (!matchesQuery || !matchesFilter) {
      continue;
    }

    const round = byRound.get(set.round.name);
    if (round === undefined) {
      byRound.set(set.round.name, {
        order: set.round.order,
        sets: [set],
      });
    } else {
      round.sets.push(set);
    }
  }

  return [...byRound.entries()]
    .map(([name, round]) => ({ name, ...round }))
    .sort((left, right) => left.order - right.order);
}

export function connectionNotice(
  connection: ConnectionState,
  socketError: string | null,
): ConnectionNotice | null {
  const message = connection.message ?? socketError;
  if (message === null) {
    return null;
  }

  const title =
    connection.status === "error"
      ? "Provider needs attention"
      : connection.status === "loading"
        ? "Loading tournament data"
        : "Showing last known tournament data";

  return {
    canRetry: connection.status !== "loading",
    message,
    title,
    tone: providerTone(connection.status),
    variant: connection.status === "error" ? "error" : "warning",
  };
}
