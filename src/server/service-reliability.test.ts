import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderRegistry, type TournamentDataProvider } from "../providers/index.ts";
import type { NormalizedSet } from "../shared/contracts.ts";
import { fixtureEvent, fixtureProvider, fixtureSet, MemoryOperatorStore } from "./fixtures.test-support.ts";
import { TournamentService } from "./service.ts";

const services: TournamentService[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
});

afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
});

function create(
  provider: TournamentDataProvider = fixtureProvider(),
  store = new MemoryOperatorStore(),
): TournamentService {
  const service = new TournamentService(new ProviderRegistry([provider]), store, 1_000, 10_000);
  services.push(service);
  return service;
}

async function load(service: TournamentService, id = "event-1"): Promise<void> {
  await service.dispatch({ type: "event.load", providerId: "startgg", input: fixtureEvent(id).slug });
}

async function take(service: TournamentService, setId = "group-1-a", eventId = "event-1"): Promise<void> {
  await service.dispatch({ type: "live.take", setId, eventId });
}

describe("preview and broadcast separation", () => {
  it("preserves newer navigation and live controls while an older selection waits for persistence", async () => {
    const store = new MemoryOperatorStore();
    const service = create(fixtureProvider(), store);
    await load(service);
    await take(service);
    await service.dispatch({ type: "phase.select", phaseGroupId: "group-2" });
    const writing = Promise.withResolvers<void>();
    const save = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (operator) => {
      await writing.promise;
      await save(operator);
    });
    const selecting = service.dispatch({ type: "set.select", setId: "group-1-b" });
    const cancelled = expect(selecting).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    const newerPhase = service.dispatch({ type: "phase.select", phaseGroupId: "group-2" });
    const hidden = service.dispatch({ type: "overlay.visibility", visible: false });
    const swapped = service.dispatch({ type: "presentation.swap" });
    await vi.advanceTimersByTimeAsync(0);
    writing.resolve();
    await Promise.all([cancelled, newerPhase, hidden, swapped]);
    expect(service.getState().operator).toMatchObject({
      selectedPhaseGroupId: "group-2",
      selectedSetId: "group-2-a",
      liveSelection: { setId: "group-1-a" },
      presentation: { overlayVisible: false, sideOrder: "swapped" },
    });
    expect(store.state).toEqual(service.getState().operator);
  });

  it("surfaces a failed state restore and blocks commands before they can mutate the scene", async () => {
    const store = new MemoryOperatorStore();
    vi.spyOn(store, "load").mockRejectedValue(new Error("Saved schema is newer than this application."));
    const save = vi.spyOn(store, "save");
    const service = create(fixtureProvider(), store);
    await expect(service.initialize()).rejects.toThrow("Saved schema is newer");
    expect(service.getState().connection).toMatchObject({
      status: "error",
    });
    expect(service.getState().connection.message).toContain("No scene changes will be accepted");
    const revision = service.getState().revision;
    await expect(service.dispatch({ type: "presentation.swap" })).rejects.toThrow("Saved settings could not be restored");
    expect(service.getState().revision).toBe(revision);
    expect(service.getState().operator.presentation.sideOrder).toBe("normal");
    expect(save).not.toHaveBeenCalled();
    service.replaceProvider(fixtureProvider());
    expect(service.getState().connection.message).toContain("No scene changes will be accepted");
  });

  it("keeps OBS empty until Take live and preserves it across set, phase and event browsing", async () => {
    const service = create();
    await load(service);
    expect(service.getState().overlay.setId).toBeNull();
    await take(service);
    const original = service.getState().overlay;

    await service.dispatch({ type: "set.select", setId: "group-1-b" });
    await service.dispatch({ type: "phase.select", phaseGroupId: "group-2" });
    expect(service.getState().overlay.setId).toBe(original.setId);
    await load(service, "event-2");
    expect(service.getState().overlay.eventName).toBe("event-1");
    expect(service.getState().overlay.players).toEqual(original.players);
    await take(service, "group-1-a", "event-2");
    expect(service.getState().overlay.eventName).toBe("event-2");
  });

  it("does not replace the live scene when fetching the next set fails", async () => {
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const service = create({ ...provider, loadSet });
    await load(service);
    await take(service);
    loadSet.mockRejectedValueOnce(new ProviderError("request_timeout", "Timed out"));
    await expect(take(service, "group-1-b")).rejects.toThrow("Timed out");
    expect(service.getState().overlay.setId).toBe("group-1-a");
    await expect(take(service, "group-1-a", "old-event")).rejects.toThrow("no longer available");
  });

  it("restores the live scene independently of the preview event", async () => {
    const store = new MemoryOperatorStore();
    const service = create(fixtureProvider(), store);
    await load(service);
    await take(service);
    await service.dispatch({ type: "presentation.swap" });
    await load(service, "event-2");
    await service.dispatch({ type: "set.select", setId: "group-1-b" });
    service.close();
    const restored = create(fixtureProvider(), store);
    await restored.initialize();
    expect(restored.getState()).toMatchObject({
      event: { id: "event-2" },
      operator: { selectedSetId: "group-1-b", presentation: { sideOrder: "swapped" } },
      overlay: { eventName: "event-1", setId: "group-1-a" },
      liveConnection: { status: "fresh" },
    });
  });

  it("does not put a preview-only persisted selection on air after restart", async () => {
    const store = new MemoryOperatorStore();
    const service = create(fixtureProvider(), store);
    await load(service);
    service.close();
    const restored = create(fixtureProvider(), store);
    await restored.initialize();
    expect(restored.getState().operator.selectedSetId).toBe("group-1-a");
    expect(restored.getState().overlay.setId).toBeNull();
  });
});

describe("independent recovery and freshness", () => {
  it("continues live polling after a failed refresh and retries the bracket automatically", async () => {
    const provider = fixtureProvider();
    const metadata = vi.fn(provider.loadEvent.bind(provider));
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const service = create({ ...provider, loadEvent: metadata, loadSet });
    await load(service);
    await take(service);
    metadata.mockRejectedValueOnce(new ProviderError("request_timeout", "Temporary outage"));
    await expect(service.dispatch({ type: "refresh" })).rejects.toThrow("Temporary outage");
    expect(service.getState().connection).toMatchObject({ status: "stale", failureCount: 1 });
    expect(service.getState().connection.nextPollAt).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(loadSet.mock.calls.length).toBeGreaterThan(2);
    expect(metadata).toHaveBeenCalledTimes(3);
    expect(service.getState()).toMatchObject({
      connection: { status: "fresh", failureCount: 0 },
      liveConnection: { status: "fresh" },
      overlay: { setId: "group-1-a" },
    });
  });

  it("retries an initial transient load failure without a live set", async () => {
    const provider = fixtureProvider();
    const metadata = vi.fn(provider.loadEvent.bind(provider)).mockRejectedValueOnce(new Error("Offline"));
    const service = create({ ...provider, loadEvent: metadata });
    await expect(load(service)).rejects.toThrow("Offline");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getState().connection.status).toBe("fresh");
    expect(service.getState().overlay.setId).toBeNull();
  });

  it("does not repeatedly retry invalid input", async () => {
    const provider = fixtureProvider();
    const metadata = vi.fn(provider.loadEvent.bind(provider)).mockRejectedValue(new ProviderError("invalid_event", "Invalid URL"));
    const service = create({ ...provider, loadEvent: metadata });
    await expect(load(service)).rejects.toThrow("Invalid URL");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(service.getState().connection.nextPollAt).toBeNull();
  });

  it("reports persistence failures instead of acknowledging success or retrying the provider", async () => {
    const provider = fixtureProvider();
    const metadata = vi.fn(provider.loadEvent.bind(provider));
    const store = new MemoryOperatorStore();
    vi.spyOn(store, "save").mockRejectedValue(new Error("Disk full"));
    const service = create({ ...provider, loadEvent: metadata }, store);
    await expect(load(service)).rejects.toMatchObject({ code: "persistence_failed" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(service.getState().connection.nextPollAt).toBeNull();
  });

  it("refreshes all visible bracket sets on a separate cadence without advancing bracket freshness on live polls", async () => {
    const provider = fixtureProvider();
    let completed = false;
    const groups = vi.fn((id: string) => Promise.resolve([
      fixtureSet(`${id}-a`, id),
      { ...fixtureSet(`${id}-b`, id), state: completed ? "completed" as const : "pending" as const },
    ]));
    const service = create({ ...provider, loadPhaseGroupSets: groups });
    await load(service);
    await take(service);
    const firstTimestamp = service.getState().connection.lastUpdatedAt;
    completed = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(service.getState().liveConnection.lastUpdatedAt).not.toBe(firstTimestamp);
    expect(service.getState().connection.lastUpdatedAt).toBe(firstTimestamp);
    expect(service.getState().event?.phaseGroups[0]?.setsFetchedAt).toBe(firstTimestamp);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(groups).toHaveBeenCalledTimes(2);
    expect(service.getState().event?.phaseGroups[0]?.sets[1]?.state).toBe("completed");
    expect(service.getState().connection.lastUpdatedAt).not.toBe(firstTimestamp);
  });

  it("reuses young caches but reloads expired groups on return", async () => {
    const provider = fixtureProvider();
    const groups = vi.fn(provider.loadPhaseGroupSets.bind(provider));
    const service = create({ ...provider, loadPhaseGroupSets: groups });
    await load(service);
    await service.dispatch({ type: "phase.select", phaseGroupId: "group-2" });
    await service.dispatch({ type: "phase.select", phaseGroupId: "group-1" });
    expect(groups).toHaveBeenCalledTimes(2);
    await service.dispatch({ type: "phase.select", phaseGroupId: "group-2" });
    await vi.advanceTimersByTimeAsync(11_000);
    await service.dispatch({ type: "phase.select", phaseGroupId: "group-1" });
    expect(groups.mock.calls.filter(([id]) => id === "group-1")).toHaveLength(2);
  });

  it("keeps live polling during a slow phase load", async () => {
    const provider = fixtureProvider();
    let finish: ((sets: readonly NormalizedSet[]) => void) | undefined;
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const service = create({
      ...provider,
      loadSet,
      loadPhaseGroupSets: (id, name, options) => id === "group-2"
        ? new Promise((resolve) => { finish = resolve; })
        : provider.loadPhaseGroupSets(id, name, options),
    });
    await load(service);
    await take(service);
    const browsing = service.dispatch({ type: "phase.select", phaseGroupId: "group-2" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(loadSet).toHaveBeenCalledTimes(4);
    expect(service.getState().connection.status).toBe("loading");
    expect(service.getState().liveConnection.status).toBe("fresh");
    finish?.([fixtureSet("next", "group-2")]);
    await browsing;
    expect(service.getState().overlay.setId).toBe("group-1-a");
  });

  it("backs off live failures and recovers without changing the preview connection", async () => {
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const service = create({ ...provider, loadSet });
    await load(service);
    await take(service);
    loadSet.mockRejectedValueOnce(new Error("Live timeout"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getState()).toMatchObject({
      overlay: { status: "stale", setId: "group-1-a" },
      liveConnection: { failureCount: 1 },
      connection: { status: "fresh" },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getState().liveConnection).toMatchObject({ status: "fresh", failureCount: 0 });
  });

  it("does not let an obsolete in-flight poll replace a newly taken scene", async () => {
    const provider = fixtureProvider();
    let finish: ((set: NormalizedSet) => void) | undefined;
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const service = create({ ...provider, loadSet });
    await load(service);
    await take(service);
    loadSet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(1_000);
    await take(service, "group-1-b");
    finish?.(fixtureSet("group-1-a", "group-1", 99));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getState().overlay.setId).toBe("group-1-b");
    expect(service.getState().overlay.players[0]?.score).toBe(0);
  });

  it("retries a saved live scene after a transient restore failure", async () => {
    const store = new MemoryOperatorStore();
    const previous = create(fixtureProvider(), store);
    await load(previous);
    await take(previous);
    previous.close();
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider))
      .mockRejectedValueOnce(new Error("Temporary live restore failure"));
    const restored = create({ ...provider, loadSet }, store);
    await expect(restored.initialize()).rejects.toThrow("Temporary live restore failure");
    expect(restored.getState().liveConnection.status).toBe("error");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(restored.getState()).toMatchObject({
      liveConnection: { status: "fresh", failureCount: 0 },
      overlay: { setId: "group-1-a" },
    });
  });

  it("cancels a pending Take live and scheduled recovery when closed", async () => {
    const provider = fixtureProvider();
    let finish: ((set: NormalizedSet) => void) | undefined;
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const service = create({ ...provider, loadSet });
    await load(service);
    loadSet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const taking = take(service);
    const cancelled = expect(taking).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    service.close();
    finish?.(fixtureSet("group-1-a"));
    await cancelled;
    const revision = service.getState().revision;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(service.getState().revision).toBe(revision);
    expect(service.getState().overlay.setId).toBeNull();
    expect(loadSet).toHaveBeenCalledTimes(1);
  });
});
