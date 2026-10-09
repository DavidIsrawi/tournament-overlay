import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry, type TournamentDataProvider } from "../providers/index.ts";
import type { ClientCommand, NormalizedSet } from "../shared/contracts.ts";
import { fixtureEvent, fixtureProvider, fixtureSet, MemoryOperatorStore } from "./fixtures.test-support.ts";
import { AUTO_TAKE_DELAY_MS, TournamentService } from "./service.ts";

const services: TournamentService[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
});

afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function create() {
  const provider = fixtureProvider();
  let live = fixtureSet("group-1-a");
  let next = fixtureSet("group-1-b");
  const loadSet = vi.fn<TournamentDataProvider["loadSet"]>((id) =>
    Promise.resolve(id === live.id ? live : next));
  const store = new MemoryOperatorStore();
  const service = new TournamentService(new ProviderRegistry([{ ...provider, loadSet }]), store, 1_000, 60_000);
  services.push(service);
  return {
    service, store, provider, loadSet,
    setLive: (set: NormalizedSet) => { live = set; },
    setNext: (set: NormalizedSet) => { next = set; },
    complete: async () => {
      live = { ...live, state: "completed", winnerId: live.entrants[0]?.entrant.id ?? null };
      await vi.advanceTimersByTimeAsync(1_000);
    },
  };
}

async function prepareManualFixture() {
  const provider = fixtureProvider();
  const previous = fixtureSet("group-1-c");
  const sets = new Map([
    [previous.id, previous],
    ["group-1-a", fixtureSet("group-1-a")],
    ["group-1-b", fixtureSet("group-1-b")],
  ]);
  const requests: {
    readonly resolve: (set: NormalizedSet) => void;
    readonly reject: (error: unknown) => void;
    readonly signal: AbortSignal | undefined;
  }[] = [];
  let hold = false;
  const loadSet = vi.fn<TournamentDataProvider["loadSet"]>((id, _event, options) => {
    const set = sets.get(id);
    if (set === undefined) {
      return Promise.reject(new Error(`Unknown fixture set ${id}`));
    }
    if (hold && id === previous.id) {
      const pending = Promise.withResolvers<NormalizedSet>();
      requests.push({ resolve: pending.resolve, reject: pending.reject, signal: options?.signal });
      return pending.promise;
    }
    return Promise.resolve(set);
  });
  const store = new MemoryOperatorStore();
  const service = new TournamentService(new ProviderRegistry([{
    ...provider,
    loadSet,
    loadPhaseGroupSets: async (...args) => {
      const loaded = await provider.loadPhaseGroupSets(...args);
      return args[0] === previous.phaseGroupId ? [...loaded, previous] : loaded;
    },
  }]), store, 1_000, 60_000);
  services.push(service);
  await service.dispatch({ type: "event.load", providerId: "startgg", input: fixtureEvent().slug });
  await service.dispatch({ type: "live.take", eventId: "event-1", setId: previous.id });
  await prepare(service);
  hold = true;
  return {
    service, store, requests, previous, sets,
    releaseManualReads: () => { hold = false; },
    completeLive: () => { sets.set("group-1-a", { ...fixtureSet("group-1-a"), state: "completed" }); },
  };
}

async function prepare(service: TournamentService, enabled = true): Promise<void> {
  await service.dispatch({ type: "event.load", providerId: "startgg", input: fixtureEvent().slug });
  await service.dispatch({ type: "live.take", eventId: "event-1", setId: "group-1-a" });
  await service.dispatch({ type: "set.select", setId: "group-1-b" });
  if (enabled) {
    await service.dispatch({ type: "live.auto.settings", enabled: true });
  }
}

function expectAutoTakeError(service: TournamentService, message: string): void {
  const automatic = service.getState().autoTake;
  expect(automatic?.status).toBe("error");
  if (automatic?.status !== "error") {
    throw new Error("Expected a reported auto-live failure.");
  }
  expect(automatic.message).toContain(message);
}

describe("automatic next-set take", () => {
  it("defaults off and does not arm when enabled after an already-completed set", async () => {
    const fixture = create();
    await prepare(fixture.service, false);
    expect(fixture.service.getState().operator.autoTakeEnabled).toBe(false);
    fixture.setLive(fixtureSet("group-1-a", "group-1", 3));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.service.getState().autoTake).toBeNull();
    await fixture.complete();
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
    await fixture.service.dispatch({ type: "live.auto.settings", enabled: true });
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState().autoTake).toBeNull();
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
  });

  it("does not interpret winning-looking scores as completion even when enabled", async () => {
    const fixture = create();
    await prepare(fixture.service);
    const set = fixtureSet("group-1-a", "group-1", 3);
    fixture.setLive({
      ...set,
      entrants: [set.entrants[0], set.entrants[1] === null ? null : { ...set.entrants[1], score: 1 }],
    });
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS + 1_000);
    expect(fixture.service.getState().autoTake).toBeNull();
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
  });

  it("queues the selected set for exactly ten seconds, fetches fresh scores and saves history", async () => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.complete();
    expect(fixture.service.getState().autoTake).toEqual({
      status: "countdown",
      eventId: "event-1",
      setId: "group-1-b",
      takeAt: new Date(Date.now() + AUTO_TAKE_DELAY_MS).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS - 1);
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
    fixture.setNext(fixtureSet("group-1-b", "group-1", 1));
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.service.getState()).toMatchObject({
      autoTake: null,
      overlay: { setId: "group-1-b", players: [{ score: 1 }, { score: 1 }] },
      operator: { autoTakeEnabled: true, previousLiveSelection: { setId: "group-1-a" } },
    });
    expect(fixture.store.state?.liveSelection?.setId).toBe("group-1-b");
    expect(fixture.loadSet.mock.calls.filter(([id]) => id === "group-1-b")).toHaveLength(1);
  });

  it.each([
    { type: "live.auto.cancel" },
    { type: "live.auto.settings", enabled: false },
    { type: "overlay.visibility", visible: false },
    { type: "set.select", setId: "group-1-a" },
    { type: "phase.select", phaseGroupId: "group-2" },
    { type: "event.load", providerId: "startgg", input: fixtureEvent("event-2").slug },
    { type: "refresh" },
  ] satisfies ClientCommand[])("cancels without rearming on repeated completion snapshots: %j", async (command) => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.complete();
    await fixture.service.dispatch(command);
    expect(fixture.service.getState().autoTake).toBeNull();
    await vi.advanceTimersByTimeAsync(2 * AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
    expect(fixture.service.getState().autoTake).toBeNull();
  });

  it("lets a manual take override the countdown immediately", async () => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.complete();
    await fixture.service.dispatch({ type: "live.take", eventId: "event-1", setId: "group-1-b" });
    expect(fixture.service.getState().overlay.setId).toBe("group-1-b");
    expect(fixture.service.getState().autoTake).toBeNull();
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.loadSet.mock.calls.filter(([id]) => id === "group-1-b"))
      .toHaveLength(1 + AUTO_TAKE_DELAY_MS / 1_000);
  });

  it("lets restoring previous live override the countdown", async () => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.service.dispatch({ type: "live.take", eventId: "event-1", setId: "group-1-b" });
    await fixture.service.dispatch({ type: "live.take", eventId: "event-1", setId: "group-1-a" });
    await fixture.complete();
    await fixture.service.dispatch({ type: "live.restore" });
    expect(fixture.service.getState().autoTake).toBeNull();
    expect(fixture.service.getState().overlay.setId).toBe("group-1-b");
  });

  it.each(["live.take", "live.restore"] as const)("does not override an in-flight manual %s when live polling observes completion", async (type) => {
    const fixture = await prepareManualFixture();
    const command: ClientCommand = type === "live.take"
      ? { type, eventId: "event-1", setId: fixture.previous.id }
      : { type };
    const result = fixture.service.dispatch(command).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.requests).toHaveLength(1);
    fixture.completeLive();
    await vi.advanceTimersByTimeAsync(1_000 + AUTO_TAKE_DELAY_MS);
    expect(fixture.requests[0]?.signal?.aborted).toBe(false);
    expect(fixture.service.getState()).toMatchObject({ autoTake: null, overlay: { setId: "group-1-a" } });
    fixture.requests[0]?.resolve(fixture.previous);
    expect(await result).toBeNull();
    expect(fixture.service.getState().overlay.setId).toBe(fixture.previous.id);

    fixture.releaseManualReads();
    fixture.sets.set(fixture.previous.id, { ...fixture.previous, state: "completed" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.service.getState().autoTake?.status).toBe("countdown");
  });

  it("keeps the latest manual take protected after it supersedes an earlier restore", async () => {
    const fixture = await prepareManualFixture();
    const restore = fixture.service.dispatch({ type: "live.restore" }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const take = fixture.service.dispatch({ type: "live.take", eventId: "event-1", setId: fixture.previous.id })
      .then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(await restore).toMatchObject({ name: "AbortError" });
    expect(fixture.requests).toHaveLength(2);
    fixture.completeLive();
    await vi.advanceTimersByTimeAsync(1_000 + AUTO_TAKE_DELAY_MS);
    expect(fixture.requests[1]?.signal?.aborted).toBe(false);
    expect(fixture.service.getState().autoTake).toBeNull();
    fixture.requests[0]?.resolve(fixture.previous);
    fixture.requests[1]?.resolve(fixture.previous);
    expect(await take).toBeNull();
    expect(fixture.service.getState().overlay.setId).toBe(fixture.previous.id);
  });

  it("keeps manual transition ownership until its scene save finishes", async () => {
    const fixture = await prepareManualFixture();
    fixture.releaseManualReads();
    const pending = Promise.withResolvers<void>();
    const save = fixture.store.save.bind(fixture.store);
    vi.spyOn(fixture.store, "save").mockImplementationOnce((operator) => pending.promise.then(() => save(operator)));
    const take = fixture.service.dispatch({ type: "live.take", eventId: "event-1", setId: fixture.previous.id })
      .then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.service.getState().overlay.setId).toBe(fixture.previous.id);
    fixture.sets.set(fixture.previous.id, { ...fixture.previous, state: "completed" });
    await vi.advanceTimersByTimeAsync(1_000 + AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState()).toMatchObject({ autoTake: null, overlay: { setId: fixture.previous.id } });
    pending.resolve();
    expect(await take).toBeNull();
    expect(fixture.store.state?.liveSelection?.setId).toBe(fixture.previous.id);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.service.getState().autoTake).toBeNull();
  });

  it("releases manual transition ownership after a failed fetch", async () => {
    const fixture = await prepareManualFixture();
    const result = fixture.service.dispatch({ type: "live.restore" }).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    fixture.requests[0]?.reject(new Error("Restore offline"));
    expect(await result).toMatchObject({ message: "Restore offline" });
    fixture.completeLive();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.service.getState().autoTake?.status).toBe("countdown");
  });

  it("does not queue a hidden output or a preview that is already live", async () => {
    const hidden = create();
    await prepare(hidden.service);
    await hidden.service.dispatch({ type: "overlay.visibility", visible: false });
    await hidden.complete();
    expect(hidden.service.getState().autoTake).toBeNull();
    const same = create();
    await prepare(same.service);
    await same.service.dispatch({ type: "set.select", setId: "group-1-a" });
    await same.complete();
    expect(same.service.getState().autoTake).toBeNull();
  });

  it("cancels when live data becomes stale or completion is corrected", async () => {
    const stale = create();
    await prepare(stale.service);
    await stale.complete();
    stale.loadSet.mockRejectedValueOnce(new Error("Provider offline"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stale.service.getState().autoTake).toBeNull();
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(stale.service.getState().overlay.setId).toBe("group-1-a");

    const corrected = create();
    await prepare(corrected.service);
    await corrected.complete();
    corrected.setLive(fixtureSet("group-1-a"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(corrected.service.getState().autoTake).toBeNull();
  });

  it.each(["completed", "unresolved"] as const)("rejects a freshly fetched %s target without replacing air", async (condition) => {
    const fixture = create();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await prepare(fixture.service);
    await fixture.complete();
    const target = fixtureSet("group-1-b");
    fixture.setNext(condition === "completed"
      ? { ...target, state: "completed" }
      : { ...target, entrants: [target.entrants[0], null] });
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
    expectAutoTakeError(fixture.service, "Select another set");
    expect(warn).toHaveBeenCalled();
  });

  it("surfaces fetch and persistence errors instead of silently retrying", async () => {
    const fixture = create();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await prepare(fixture.service);
    await fixture.complete();
    const load = fixture.loadSet.getMockImplementation()!;
    fixture.loadSet.mockImplementation((id, ...args) =>
      id === "group-1-b" ? Promise.reject(new Error("Next set offline")) : load(id, ...args));
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState().overlay.setId).toBe("group-1-a");
    expectAutoTakeError(fixture.service, "Next set offline");
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.loadSet.mock.calls.filter(([id]) => id === "group-1-b")).toHaveLength(1);

    const disk = create();
    await prepare(disk.service);
    await disk.complete();
    vi.spyOn(disk.store, "save").mockRejectedValueOnce(new Error("Disk full"));
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(disk.service.getState().overlay.setId).toBe("group-1-b");
    expectAutoTakeError(disk.service, "could not be saved locally");
  });

  it("cancels an in-flight automatic fetch even if the provider ignores its abort signal", async () => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.complete();
    const deferred = Promise.withResolvers<NormalizedSet>();
    const load = fixture.loadSet.getMockImplementation()!;
    fixture.loadSet.mockImplementation((id, ...args) => id === "group-1-b" ? deferred.promise : load(id, ...args));
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState().autoTake?.status).toBe("taking");
    await fixture.service.dispatch({ type: "live.auto.cancel" });
    deferred.resolve(fixtureSet("group-1-b"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.service.getState()).toMatchObject({ autoTake: null, overlay: { setId: "group-1-a" } });
  });

  it("reports an unsaved published scene when auto-live is cancelled during persistence", async () => {
    const fixture = create();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await prepare(fixture.service);
    await fixture.complete();
    const save = Promise.withResolvers<void>();
    vi.spyOn(fixture.store, "save").mockImplementationOnce(() => save.promise);
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(fixture.service.getState()).toMatchObject({ autoTake: { status: "taking" }, overlay: { setId: "group-1-b" } });
    await fixture.service.dispatch({ type: "live.auto.cancel" });
    expect(fixture.service.getState().autoTake).toBeNull();
    save.reject(new Error("Disk full"));
    await vi.advanceTimersByTimeAsync(0);
    expectAutoTakeError(fixture.service, "could not be saved locally");
    expect(fixture.service.getState().overlay.setId).toBe("group-1-b");
    expect(fixture.store.state?.liveSelection?.setId).toBe("group-1-a");
    expect(warn).toHaveBeenCalled();
  });

  it("finishes a successful scene save without rearming cancelled auto-live", async () => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.complete();
    const pending = Promise.withResolvers<void>();
    const save = fixture.store.save.bind(fixture.store);
    vi.spyOn(fixture.store, "save").mockImplementationOnce((operator) => pending.promise.then(() => save(operator)));
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    await fixture.service.dispatch({ type: "live.auto.cancel" });
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.service.getState()).toMatchObject({ autoTake: null, overlay: { setId: "group-1-b" } });
    expect(fixture.store.state?.liveSelection?.setId).toBe("group-1-b");
  });

  it("does not publish a deferred save failure after shutdown", async () => {
    const fixture = create();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await prepare(fixture.service);
    await fixture.complete();
    const save = Promise.withResolvers<void>();
    vi.spyOn(fixture.store, "save").mockImplementationOnce(() => save.promise);
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    fixture.service.close();
    const state = fixture.service.getState();
    save.reject(new Error("Disk full"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.service.getState()).toBe(state);
  });

  it("saves the setting but does not resume countdowns or auto-take restored completed sets", async () => {
    const fixture = create();
    await prepare(fixture.service);
    await fixture.complete();
    expect(fixture.store.state?.autoTakeEnabled).toBe(true);
    fixture.service.close();
    const restored = new TournamentService(new ProviderRegistry([{ ...fixture.provider, loadSet: fixture.loadSet }]), fixture.store, 1_000, 60_000);
    services.push(restored);
    await restored.initialize();
    await vi.advanceTimersByTimeAsync(AUTO_TAKE_DELAY_MS);
    expect(restored.getState()).toMatchObject({
      autoTake: null,
      overlay: { setId: "group-1-a" },
      operator: { autoTakeEnabled: true },
    });
  });
});
