import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export type ProviderId = "startgg" | (string & {});

export interface EntrantProfile {
  readonly id: string;
  readonly name: string;
  readonly prefix: string | null;
  readonly seed: number | null;
  readonly pronouns: string | null;
  readonly social: string | null;
  readonly location: {
    readonly country: string | null;
    readonly state: string | null;
  } | null;
}

export type NormalizedSetState = "pending" | "active" | "completed";

export interface NormalizedSet {
  readonly id: string;
  readonly identifier: string;
  readonly phaseGroupId: string;
  readonly phaseName: string;
  readonly round: {
    readonly name: string;
    readonly order: number;
  };
  readonly state: NormalizedSetState;
  readonly winnerId: string | null;
  readonly entrants: readonly [
    {
      readonly entrant: EntrantProfile;
      readonly score: number | null;
    } | null,
    {
      readonly entrant: EntrantProfile;
      readonly score: number | null;
    } | null,
  ];
}

export interface NormalizedPhaseGroup {
  readonly id: string;
  readonly name: string;
  readonly phaseName: string;
  readonly sets: readonly NormalizedSet[];
}

export interface NormalizedEvent {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly slug: string;
  readonly name: string;
  readonly tournamentName: string;
  readonly phaseGroups: readonly NormalizedPhaseGroup[];
  readonly fetchedAt: string;
}

export interface PresentationState {
  readonly sideOrder: "normal" | "swapped";
}

export interface OperatorState {
  readonly providerId: ProviderId;
  readonly eventInput: string;
  readonly selectedPhaseGroupId: string | null;
  readonly selectedSetId: string | null;
  readonly presentation: PresentationState;
}

export interface OverlayPlayer {
  readonly sourceEntrantId: string;
  readonly displayName: string;
  readonly prefix: string | null;
  readonly score: number | null;
  readonly seed: number | null;
  readonly pronouns: string | null;
  readonly social: string | null;
  readonly location: string | null;
  readonly isWinner: boolean;
}

export interface OverlayView {
  readonly revision: number;
  readonly status: "empty" | "ready" | "stale" | "error";
  readonly setId: string | null;
  readonly tournamentName: string;
  readonly eventName: string;
  readonly phaseName: string;
  readonly roundName: string;
  readonly players: readonly [OverlayPlayer | null, OverlayPlayer | null];
}

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly name: string;
  readonly configured: boolean;
}

export interface ConnectionState {
  readonly status: "idle" | "loading" | "fresh" | "stale" | "error";
  readonly message: string | null;
  readonly lastUpdatedAt: string | null;
  readonly nextPollAt: string | null;
  readonly failureCount: number;
}

export interface ServerState {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly revision: number;
  readonly startedAt: string;
  readonly providers: readonly ProviderDescriptor[];
  readonly operator: OperatorState;
  readonly connection: ConnectionState;
  readonly event: NormalizedEvent | null;
  readonly overlay: OverlayView;
}

export const presentationStateSchema = z.object({
  sideOrder: z.enum(["normal", "swapped"]),
});

export const operatorStateSchema = z.object({
  providerId: z.string().min(1),
  eventInput: z.string(),
  selectedPhaseGroupId: z.string().nullable(),
  selectedSetId: z.string().nullable(),
  presentation: presentationStateSchema,
});

const eventLoadCommandSchema = z.object({
  type: z.literal("event.load"),
  providerId: z.string().min(1),
  input: z.string().min(1),
});

const phaseSelectCommandSchema = z.object({
  type: z.literal("phase.select"),
  phaseGroupId: z.string().min(1),
});

const setSelectCommandSchema = z.object({
  type: z.literal("set.select"),
  setId: z.string().min(1),
});

const presentationSwapCommandSchema = z.object({
  type: z.literal("presentation.swap"),
});

const presentationClearCommandSchema = z.object({
  type: z.literal("presentation.clear"),
});

const refreshCommandSchema = z.object({
  type: z.literal("refresh"),
});

export const clientCommandSchema = z.discriminatedUnion("type", [
  eventLoadCommandSchema,
  phaseSelectCommandSchema,
  setSelectCommandSchema,
  presentationSwapCommandSchema,
  presentationClearCommandSchema,
  refreshCommandSchema,
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("client.hello"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    client: z.enum(["dashboard", "overlay"]),
  }),
  z.object({
    type: z.literal("command"),
    commandId: z.string().min(1),
    command: clientCommandSchema,
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | {
      readonly type: "state.snapshot";
      readonly state: ServerState;
    }
  | {
      readonly type: "command.ack";
      readonly commandId: string;
    }
  | {
      readonly type: "command.error";
      readonly commandId: string | null;
      readonly code: string;
      readonly message: string;
    };

const entrantProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string().nullable(),
  seed: z.number().nullable(),
  pronouns: z.string().nullable(),
  social: z.string().nullable(),
  location: z
    .object({
      country: z.string().nullable(),
      state: z.string().nullable(),
    })
    .nullable(),
});

const normalizedSetSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  phaseGroupId: z.string(),
  phaseName: z.string(),
  round: z.object({
    name: z.string(),
    order: z.number(),
  }),
  state: z.enum(["pending", "active", "completed"]),
  winnerId: z.string().nullable(),
  entrants: z.tuple([
    z
      .object({
        entrant: entrantProfileSchema,
        score: z.number().nullable(),
      })
      .nullable(),
    z
      .object({
        entrant: entrantProfileSchema,
        score: z.number().nullable(),
      })
      .nullable(),
  ]),
});

const normalizedEventSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  slug: z.string(),
  name: z.string(),
  tournamentName: z.string(),
  phaseGroups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phaseName: z.string(),
      sets: z.array(normalizedSetSchema),
    }),
  ),
  fetchedAt: z.string(),
});

const connectionStateSchema = z.object({
  status: z.enum(["idle", "loading", "fresh", "stale", "error"]),
  message: z.string().nullable(),
  lastUpdatedAt: z.string().nullable(),
  nextPollAt: z.string().nullable(),
  failureCount: z.number().int().nonnegative(),
});

const overlayPlayerSchema = z.object({
  sourceEntrantId: z.string(),
  displayName: z.string(),
  prefix: z.string().nullable(),
  score: z.number().nullable(),
  seed: z.number().nullable(),
  pronouns: z.string().nullable(),
  social: z.string().nullable(),
  location: z.string().nullable(),
  isWinner: z.boolean(),
});

const overlayViewSchema = z.object({
  revision: z.number().int().nonnegative(),
  status: z.enum(["empty", "ready", "stale", "error"]),
  setId: z.string().nullable(),
  tournamentName: z.string(),
  eventName: z.string(),
  phaseName: z.string(),
  roundName: z.string(),
  players: z.tuple([
    overlayPlayerSchema.nullable(),
    overlayPlayerSchema.nullable(),
  ]),
});

export const serverStateSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  revision: z.number().int().nonnegative(),
  startedAt: z.string(),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      configured: z.boolean(),
    }),
  ),
  operator: operatorStateSchema,
  connection: connectionStateSchema,
  event: normalizedEventSchema.nullable(),
  overlay: overlayViewSchema,
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state.snapshot"),
    state: serverStateSchema,
  }),
  z.object({
    type: z.literal("command.ack"),
    commandId: z.string(),
  }),
  z.object({
    type: z.literal("command.error"),
    commandId: z.string().nullable(),
    code: z.string(),
    message: z.string(),
  }),
]);

export function formatEntrantLocation(entrant: EntrantProfile): string | null {
  if (entrant.location === null) {
    return null;
  }

  const parts = [entrant.location.state, entrant.location.country].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function deriveOverlayView(
  revision: number,
  event: NormalizedEvent | null,
  set: NormalizedSet | null,
  presentation: PresentationState,
  connectionStatus: ConnectionState["status"],
): OverlayView {
  if (event === null || set === null) {
    return {
      revision,
      status: connectionStatus === "error" ? "error" : "empty",
      setId: null,
      tournamentName: event?.tournamentName ?? "",
      eventName: event?.name ?? "",
      phaseName: "",
      roundName: "",
      players: [null, null],
    };
  }

  const sourcePlayers = set.entrants.map((slot) => {
    if (slot === null) {
      return null;
    }

    return {
      sourceEntrantId: slot.entrant.id,
      displayName: slot.entrant.name,
      prefix: slot.entrant.prefix,
      score: slot.score,
      seed: slot.entrant.seed,
      pronouns: slot.entrant.pronouns,
      social: slot.entrant.social,
      location: formatEntrantLocation(slot.entrant),
      isWinner: set.winnerId === slot.entrant.id,
    } satisfies OverlayPlayer;
  }) as [OverlayPlayer | null, OverlayPlayer | null];

  const players =
    presentation.sideOrder === "swapped"
      ? ([sourcePlayers[1], sourcePlayers[0]] as const)
      : sourcePlayers;

  return {
    revision,
    status:
      connectionStatus === "stale" || connectionStatus === "error"
        ? "stale"
        : "ready",
    setId: set.id,
    tournamentName: event.tournamentName,
    eventName: event.name,
    phaseName: set.phaseName,
    roundName: set.round.name,
    players,
  };
}

export function findSet(
  event: NormalizedEvent | null,
  setId: string | null,
): NormalizedSet | null {
  if (event === null || setId === null) {
    return null;
  }

  for (const phaseGroup of event.phaseGroups) {
    const set = phaseGroup.sets.find((candidate) => candidate.id === setId);
    if (set !== undefined) {
      return set;
    }
  }

  return null;
}
