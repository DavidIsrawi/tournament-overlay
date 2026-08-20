import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProviderRegistry,
  type TournamentDataProvider,
} from "../providers/index.ts";
import type {
  NormalizedEvent,
  NormalizedSet,
} from "../shared/contracts.ts";
import { AtomicOperatorStateStore } from "./persistence.ts";
import { TournamentService } from "./service.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function makeSet(id: string, phaseGroupId: string): NormalizedSet {
  return {
    id,
    identifier: id,
    phaseGroupId,
    phaseName: "Pools",
    round: { name: "Round 1", order: 1 },
    state: "pending",
    winnerId: null,
    entrants: [null, null],
  };
}

function makeRichSet(id: string, phaseGroupId: string): NormalizedSet {
  return {
    ...makeSet(id, phaseGroupId),
    entrants: [
      {
        entrant: {
          id: "entrant-1",
          name: "Player 1",
          prefix: "Team",
          seed: 1,
          pronouns: "they/them",
          social: null,
          location: { country: "US", state: "WA" },
        },
        score: 0,
      },
      null,
    ],
  };
}

function makeLightweightSet(id: string, phaseGroupId: string): NormalizedSet {
  return {
    ...makeRichSet(id, phaseGroupId),
    entrants: [
      {
        entrant: {
          id: "entrant-1",
          name: "Player 1",
          prefix: null,
          seed: 1,
          pronouns: null,
          social: null,
          location: null,
        },
        score: 0,
      },
      null,
    ],
  };
}

function makeEvent(): NormalizedEvent {
  return {
    id: "event-1",
    providerId: "startgg",
    slug: "tournament/octagon/event/ultimate",
    name: "Ultimate Singles",
    tournamentName: "Octagon Open",
    phaseGroups: [
      {
        id: "group-1",
        name: "A1",
        phaseName: "Pools",
        setsLoaded: false,
        sets: [],
      },
      {
        id: "group-2",
        name: "A2",
        phaseName: "Pools",
        setsLoaded: false,
        sets: [],
      },
    ],
    fetchedAt: "2026-08-19T00:00:00.000Z",
  };
}

describe("TournamentService", () => {
  it("loads only the selected phase group and caches it when switching groups", async () => {
    const loadedGroups: string[] = [];
    const provider: TournamentDataProvider = {
      descriptor: { id: "startgg", name: "StartGG", configured: true },
      loadEvent(): Promise<NormalizedEvent> {
        return Promise.resolve(makeEvent());
      },
      loadPhaseGroupSets(phaseGroupId, _phaseName, options) {
        loadedGroups.push(phaseGroupId);
        const sets = [makeSet(`set-${phaseGroupId}`, phaseGroupId)];
        options?.onProgress?.({
          loadedPages: 1,
          totalPages: 1,
          sets,
        });
        return Promise.resolve(sets);
      },
      loadSet(setId, event) {
        const set = event.phaseGroups
          .flatMap((group) => group.sets)
          .find((candidate) => candidate.id === setId);
        if (set === undefined) {
          return Promise.reject(new Error("Set not found"));
        }
        return Promise.resolve(set);
      },
    };
    const directory = await mkdtemp(join(tmpdir(), "overlay-service-"));
    directories.push(directory);
    const service = new TournamentService(
      new ProviderRegistry([provider]),
      new AtomicOperatorStateStore(join(directory, "state.json")),
      120_000,
    );

    await service.loadEvent(
      "startgg",
      "tournament/octagon/event/ultimate",
      false,
    );

    expect(loadedGroups).toEqual(["group-1"]);
    expect(service.getState().event?.phaseGroups).toMatchObject([
      { id: "group-1", setsLoaded: true },
      { id: "group-2", setsLoaded: false },
    ]);

    await service.dispatch({
      type: "phase.select",
      phaseGroupId: "group-2",
    });

    expect(loadedGroups).toEqual(["group-1", "group-2"]);
    expect(service.getState().event?.phaseGroups).toMatchObject([
      { id: "group-1", setsLoaded: true },
      { id: "group-2", setsLoaded: true },
    ]);

    await service.dispatch({
      type: "overlay.select",
      templateId: "minimal",
    });
    expect(service.getState().operator.presentation.overlayTemplateId).toBe(
      "minimal",
    );
    service.close();
  });

  it("keeps the current scene live while refreshing a cached phase group", async () => {
    let phaseLoadCount = 0;
    let resolveRefresh: ((sets: readonly NormalizedSet[]) => void) | undefined;
    let markRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const provider: TournamentDataProvider = {
      descriptor: { id: "startgg", name: "StartGG", configured: true },
      loadEvent: () => Promise.resolve(makeEvent()),
      loadPhaseGroupSets(phaseGroupId, _phaseName, options) {
        phaseLoadCount += 1;
        const sets =
          phaseLoadCount === 1
            ? [makeRichSet("set-1", phaseGroupId)]
            : [makeLightweightSet("set-1", phaseGroupId)];
        if (phaseLoadCount === 1) {
          return Promise.resolve(sets);
        }
        options?.onProgress?.({
          loadedPages: 1,
          totalPages: 2,
          sets: [],
        });
        markRefreshStarted?.();
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      },
      loadSet: (setId, event) => {
        const set = event.phaseGroups
          .flatMap((group) => group.sets)
          .find((candidate) => candidate.id === setId);
        return set === undefined
          ? Promise.reject(new Error("Set not found"))
          : Promise.resolve(set);
      },
    };
    const directory = await mkdtemp(join(tmpdir(), "overlay-refresh-"));
    directories.push(directory);
    const service = new TournamentService(
      new ProviderRegistry([provider]),
      new AtomicOperatorStateStore(join(directory, "state.json")),
      120_000,
    );
    await service.loadEvent(
      "startgg",
      "tournament/octagon/event/ultimate",
      false,
    );

    const refresh = service.loadEvent(
      "startgg",
      "tournament/octagon/event/ultimate",
      true,
    );
    await refreshStarted;

    const loadingState = service.getState();
    expect(loadingState).toMatchObject({
      operator: { selectedSetId: "set-1" },
      overlay: { status: "ready", setId: "set-1" },
    });
    expect(loadingState.event?.phaseGroups[0]).toMatchObject({
      id: "group-1",
      setsLoaded: true,
      sets: [{ id: "set-1" }],
    });

    await service.dispatch({ type: "presentation.swap" });
    resolveRefresh?.([makeLightweightSet("set-1", "group-1")]);
    await refresh;
    expect(service.getState().operator.presentation.sideOrder).toBe("swapped");
    expect(
      service.getState().event?.phaseGroups[0]?.sets[0]?.entrants[0]?.entrant,
    ).toMatchObject({
      prefix: "Team",
      pronouns: "they/them",
      location: { country: "US", state: "WA" },
    });
    service.close();
  });

  it("keeps loading remaining pages after selecting a partial set", async () => {
    let resolveGroup: ((sets: readonly NormalizedSet[]) => void) | undefined;
    let markFirstPageLoaded: (() => void) | undefined;
    const firstPageLoaded = new Promise<void>((resolve) => {
      markFirstPageLoaded = resolve;
    });
    const provider: TournamentDataProvider = {
      descriptor: { id: "startgg", name: "StartGG", configured: true },
      loadEvent: () => Promise.resolve(makeEvent()),
      loadPhaseGroupSets(phaseGroupId, _phaseName, options) {
        options?.onProgress?.({
          loadedPages: 1,
          totalPages: 2,
          sets: [makeSet("set-1", phaseGroupId)],
        });
        markFirstPageLoaded?.();
        return new Promise((resolve) => {
          resolveGroup = resolve;
        });
      },
      loadSet: (setId, event) => {
        const set = event.phaseGroups
          .flatMap((group) => group.sets)
          .find((candidate) => candidate.id === setId);
        return set === undefined
          ? Promise.reject(new Error("Set not found"))
          : Promise.resolve(set);
      },
    };
    const directory = await mkdtemp(join(tmpdir(), "overlay-partial-set-"));
    directories.push(directory);
    const service = new TournamentService(
      new ProviderRegistry([provider]),
      new AtomicOperatorStateStore(join(directory, "state.json")),
      120_000,
    );

    const load = service.loadEvent(
      "startgg",
      "tournament/octagon/event/ultimate",
      false,
    );
    await firstPageLoaded;
    await service.dispatch({ type: "set.select", setId: "set-1" });

    const partialState = service.getState();
    expect(partialState).toMatchObject({
      connection: { status: "loading" },
      operator: { selectedSetId: "set-1" },
    });
    expect(partialState.event?.phaseGroups[0]).toMatchObject({
      setsLoaded: false,
      sets: [{ id: "set-1" }],
    });

    resolveGroup?.([
      makeSet("set-1", "group-1"),
      makeSet("set-2", "group-1"),
    ]);
    await load;

    const completedState = service.getState();
    expect(completedState).toMatchObject({
      connection: { status: "fresh" },
      operator: { selectedSetId: "set-1" },
    });
    expect(completedState.event?.phaseGroups[0]).toMatchObject({
      setsLoaded: true,
    });
    expect(completedState.event?.phaseGroups[0]?.sets).toHaveLength(2);
    service.close();
  });

  it("publishes partial pages and lets a phase switch supersede the active load", async () => {
    let markFirstPageLoaded: (() => void) | undefined;
    const firstPageLoaded = new Promise<void>((resolve) => {
      markFirstPageLoaded = resolve;
    });
    const provider: TournamentDataProvider = {
      descriptor: { id: "startgg", name: "StartGG", configured: true },
      loadEvent: () => Promise.resolve(makeEvent()),
      loadPhaseGroupSets(phaseGroupId, _phaseName, options) {
        if (phaseGroupId === "group-2") {
          return Promise.resolve([makeSet("set-2", phaseGroupId)]);
        }
        options?.onProgress?.({
          loadedPages: 1,
          totalPages: 2,
          sets: [makeSet("set-1", phaseGroupId)],
        });
        markFirstPageLoaded?.();
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Superseded", "AbortError"));
            },
            { once: true },
          );
        });
      },
      loadSet: (setId, event) => {
        const set = event.phaseGroups
          .flatMap((group) => group.sets)
          .find((candidate) => candidate.id === setId);
        return set === undefined
          ? Promise.reject(new Error("Set not found"))
          : Promise.resolve(set);
      },
    };
    const directory = await mkdtemp(join(tmpdir(), "overlay-switch-"));
    directories.push(directory);
    const service = new TournamentService(
      new ProviderRegistry([provider]),
      new AtomicOperatorStateStore(join(directory, "state.json")),
      120_000,
    );

    const initialLoad = service.loadEvent(
      "startgg",
      "tournament/octagon/event/ultimate",
      false,
    );
    await firstPageLoaded;
    expect(service.getState().event?.phaseGroups[0]).toMatchObject({
      setsLoaded: false,
      sets: [{ id: "set-1" }],
    });

    await service.dispatch({
      type: "phase.select",
      phaseGroupId: "group-2",
    });
    await initialLoad;

    expect(service.getState()).toMatchObject({
      connection: { status: "fresh" },
      operator: {
        selectedPhaseGroupId: "group-2",
        selectedSetId: "set-2",
      },
    });
    service.close();
  });

  it("does not restart polling after closing an active request", async () => {
    let pollCount = 0;
    let markPollStarted: (() => void) | undefined;
    const pollStarted = new Promise<void>((resolve) => {
      markPollStarted = resolve;
    });
    const provider: TournamentDataProvider = {
      descriptor: { id: "startgg", name: "StartGG", configured: true },
      loadEvent: () => Promise.resolve(makeEvent()),
      loadPhaseGroupSets: (phaseGroupId) =>
        Promise.resolve([makeSet("set-1", phaseGroupId)]),
      loadSet(_setId, _event, options) {
        pollCount += 1;
        markPollStarted?.();
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Cancelled", "AbortError"));
            },
            { once: true },
          );
        });
      },
    };
    const directory = await mkdtemp(join(tmpdir(), "overlay-close-"));
    directories.push(directory);
    const service = new TournamentService(
      new ProviderRegistry([provider]),
      new AtomicOperatorStateStore(join(directory, "state.json")),
      5,
    );
    await service.loadEvent(
      "startgg",
      "tournament/octagon/event/ultimate",
      false,
    );
    await pollStarted;

    service.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(pollCount).toBe(1);
  });

  it("publishes provider configuration changes", async () => {
    const unavailableProvider: TournamentDataProvider = {
      descriptor: { id: "startgg", name: "StartGG", configured: false },
      loadEvent: () => Promise.reject(new Error("Not configured")),
      loadPhaseGroupSets: () => Promise.reject(new Error("Not configured")),
      loadSet: () => Promise.reject(new Error("Not configured")),
    };
    const configuredProvider: TournamentDataProvider = {
      ...unavailableProvider,
      descriptor: { id: "startgg", name: "StartGG", configured: true },
    };
    const directory = await mkdtemp(join(tmpdir(), "overlay-provider-"));
    directories.push(directory);
    const service = new TournamentService(
      new ProviderRegistry([unavailableProvider]),
      new AtomicOperatorStateStore(join(directory, "state.json")),
      120_000,
    );

    service.replaceProvider(configuredProvider);

    expect(service.getState().providers).toEqual([
      { id: "startgg", name: "StartGG", configured: true },
    ]);
    expect(service.getState().connection.status).toBe("idle");
    service.close();
  });
});
