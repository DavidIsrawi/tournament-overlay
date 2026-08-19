import type {
  EntrantProfile,
  NormalizedEvent,
  NormalizedSet,
  ProviderDescriptor,
} from "@tournament-overlay/contracts";
import { ProviderError, type TournamentDataProvider } from "./index.ts";

const entrants: readonly EntrantProfile[] = [
  {
    id: "entrant-alieb",
    name: "ALIEB",
    prefix: "PNW",
    seed: 1,
    pronouns: "he/him",
    social: "@aliebsb",
    location: { state: "WA", country: "US" },
  },
  {
    id: "entrant-neturtle",
    name: "NETURTLE",
    prefix: "OCT",
    seed: 2,
    pronouns: "she/her",
    social: "@neturtlessb",
    location: { state: "WA", country: "US" },
  },
  {
    id: "entrant-mako",
    name: "MAKO",
    prefix: null,
    seed: 3,
    pronouns: "they/them",
    social: "@makoplays",
    location: { state: "OR", country: "US" },
  },
  {
    id: "entrant-brine",
    name: "BRINE",
    prefix: "SEA",
    seed: 4,
    pronouns: null,
    social: null,
    location: { state: "BC", country: "CA" },
  },
];

function slot(
  entrant: EntrantProfile,
  score: number | null,
): NormalizedSet["entrants"][number] {
  return { entrant, score };
}

function makeSet(
  id: string,
  identifier: string,
  groupId: string,
  phaseName: string,
  roundName: string,
  roundOrder: number,
  entrantIndexes: readonly [number, number],
  scores: readonly [number | null, number | null],
  state: NormalizedSet["state"],
): NormalizedSet {
  const left = entrants[entrantIndexes[0]];
  const right = entrants[entrantIndexes[1]];
  if (left === undefined || right === undefined) {
    throw new Error("Demo fixture references a missing entrant.");
  }

  return {
    id,
    identifier,
    phaseGroupId: groupId,
    phaseName,
    round: { name: roundName, order: roundOrder },
    state,
    winnerId: state === "completed" ? left.id : null,
    entrants: [slot(left, scores[0]), slot(right, scores[1])],
  };
}

function createDemoEvent(fetchedAt: string): NormalizedEvent {
  const pools = [
    makeSet(
      "demo-set-1",
      "A1",
      "demo-pools",
      "Round Robin Pools",
      "Pool A · Round 1",
      1,
      [0, 3],
      [2, 0],
      "completed",
    ),
    makeSet(
      "demo-set-2",
      "A2",
      "demo-pools",
      "Round Robin Pools",
      "Pool A · Round 1",
      1,
      [1, 2],
      [2, 1],
      "completed",
    ),
  ];
  const topEight = [
    makeSet(
      "demo-set-3",
      "QF1",
      "demo-top-8",
      "Top 8",
      "Winners Semifinal",
      1,
      [0, 2],
      [3, 1],
      "completed",
    ),
    makeSet(
      "demo-set-4",
      "QF2",
      "demo-top-8",
      "Top 8",
      "Winners Semifinal",
      1,
      [1, 3],
      [3, 2],
      "completed",
    ),
    makeSet(
      "demo-set-5",
      "WF",
      "demo-top-8",
      "Top 8",
      "Winners Final",
      2,
      [0, 1],
      [1, 1],
      "active",
    ),
    makeSet(
      "demo-set-6",
      "LF",
      "demo-top-8",
      "Top 8",
      "Losers Final",
      3,
      [2, 3],
      [null, null],
      "pending",
    ),
    makeSet(
      "demo-set-7",
      "GF",
      "demo-top-8",
      "Top 8",
      "Grand Final",
      4,
      [0, 1],
      [null, null],
      "pending",
    ),
  ];

  return {
    id: "demo-event",
    providerId: "demo",
    slug: "demo/octagon-open",
    name: "Ultimate Singles",
    tournamentName: "Octagon Open #174",
    phaseGroups: [
      {
        id: "demo-pools",
        name: "Pools",
        phaseName: "Round Robin Pools",
        sets: pools,
      },
      {
        id: "demo-top-8",
        name: "Top 8",
        phaseName: "Top 8",
        sets: topEight,
      },
    ],
    fetchedAt,
  };
}

export class DemoProvider implements TournamentDataProvider {
  public readonly descriptor: ProviderDescriptor = {
    id: "demo",
    name: "Demo fixture",
    configured: true,
    mode: "fixture",
  };

  readonly #pollCounts = new Map<string, number>();

  public async loadEvent(input: string): Promise<NormalizedEvent> {
    if (
      input.trim() !== "demo/octagon-open" &&
      input.trim() !== "octagon-open"
    ) {
      throw new ProviderError(
        "event_not_found",
        'Demo event not found. Use "demo/octagon-open".',
      );
    }

    return Promise.resolve(createDemoEvent(new Date().toISOString()));
  }

  public async loadSet(
    setId: string,
    event: NormalizedEvent,
  ): Promise<NormalizedSet> {
    const set = event.phaseGroups
      .flatMap((phaseGroup) => phaseGroup.sets)
      .find((candidate) => candidate.id === setId);
    if (set === undefined) {
      throw new ProviderError(
        "set_not_found",
        `Demo set "${setId}" does not exist.`,
      );
    }

    if (set.id !== "demo-set-5") {
      return Promise.resolve(set);
    }

    const count = (this.#pollCounts.get(set.id) ?? 0) + 1;
    this.#pollCounts.set(set.id, count);
    const leftScore = Math.min(3, 1 + Math.floor(count / 2));

    return Promise.resolve({
      ...set,
      state: leftScore === 3 ? "completed" : "active",
      winnerId: leftScore === 3 ? set.entrants[0]?.entrant.id ?? null : null,
      entrants: [
        set.entrants[0] === null
          ? null
          : { ...set.entrants[0], score: leftScore },
        set.entrants[1],
      ],
    });
  }
}
