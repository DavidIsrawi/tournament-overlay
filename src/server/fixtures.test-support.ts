import { ProviderError, type TournamentDataProvider } from "../providers/index.ts";
import {
  findSet,
  type NormalizedEvent,
  type NormalizedSet,
  type OperatorState,
} from "../shared/contracts.ts";
import { AtomicOperatorStateStore } from "./persistence.ts";

export class MemoryOperatorStore extends AtomicOperatorStateStore {
  public state: OperatorState | null = null;

  public constructor() {
    super("unused-in-memory-store");
  }

  public override load(defaultState: OperatorState): Promise<OperatorState> {
    return Promise.resolve(this.state ?? defaultState);
  }

  public override save(state: OperatorState): Promise<void> {
    this.state = structuredClone(state);
    return Promise.resolve();
  }
}

export function fixtureSet(id: string, groupId = "group-1", score = 0): NormalizedSet {
  const slot = (index: number) => ({
    entrant: {
      id: `${id}-player-${String(index)}`,
      name: `${id} Player ${String(index + 1)}`,
      prefix: null,
      seed: index + 1,
      pronouns: null,
      social: null,
      location: null,
    },
    score,
  });
  return {
    id,
    identifier: id,
    phaseGroupId: groupId,
    phaseName: "Pools",
    round: { name: "Winners Round 1", order: 1 },
    state: "active",
    winnerId: null,
    entrants: [slot(0), slot(1)],
  };
}

export function fixtureEvent(id = "event-1"): NormalizedEvent {
  return {
    id,
    providerId: "startgg",
    slug: `tournament/example/event/${id}`,
    name: id,
    tournamentName: "Example Open",
    fetchedAt: new Date().toISOString(),
    phaseGroups: ["group-1", "group-2"].map((groupId) => ({
      id: groupId,
      name: groupId,
      phaseName: "Pools",
      setsLoaded: false,
      setsFetchedAt: null,
      sets: [],
    })),
  };
}

export function fixtureProvider(): TournamentDataProvider {
  return {
    descriptor: { id: "startgg", name: "StartGG", configured: true },
    loadEvent: (input) => Promise.resolve(fixtureEvent(input.split("/").at(-1))),
    loadPhaseGroupSets: (groupId) => Promise.resolve([
      fixtureSet(`${groupId}-a`, groupId),
      fixtureSet(`${groupId}-b`, groupId),
    ]),
    loadSet: (id, event) => {
      const set = findSet(event, id);
      return set === null
        ? Promise.reject(new ProviderError("set_not_found", "Set not found"))
        : Promise.resolve(set);
    },
  } satisfies TournamentDataProvider;
}
