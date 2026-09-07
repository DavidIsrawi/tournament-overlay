import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderRegistry, type TournamentDataProvider } from "../providers/index.ts";
import type { ClientCommand, NormalizedSet, ServerState } from "../shared/contracts.ts";
import { fixtureEvent, fixtureProvider, fixtureSet, MemoryOperatorStore } from "./fixtures.test-support.ts";
import { TournamentService } from "./service.ts";

const services: TournamentService[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
});

afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function create(provider: TournamentDataProvider = fixtureProvider(), store = new MemoryOperatorStore()) {
  const service = new TournamentService(new ProviderRegistry([provider]), store, 1_000, 10_000);
  services.push(service);
  return { service, store };
}

async function load(service: TournamentService, id = "event-1"): Promise<void> {
  await service.dispatch({ type: "event.load", providerId: "startgg", input: fixtureEvent(id).slug });
}

function take(service: TournamentService, setId = "group-1-a", eventId = "event-1"): Promise<void> {
  return service.dispatch({ type: "live.take", setId, eventId });
}

async function establishHistory(service: TournamentService): Promise<void> {
  await load(service);
  await take(service);
  await take(service, "group-1-b");
}

function air(state: ServerState) {
  return {
    eventName: state.overlay.eventName,
    setId: state.overlay.setId,
    players: state.overlay.players,
    liveSelection: state.operator.liveSelection,
    previousLiveSelection: state.operator.previousLiveSelection,
    presentation: state.operator.presentation,
  };
}

describe("persisted broadcast visibility and metadata", () => {
  it("allows hiding an empty overlay, but requires a valid live set before showing", async () => {
    const { service, store } = create();
    await service.dispatch({ type: "overlay.visibility", visible: false });
    expect(store.state?.presentation.overlayVisible).toBe(false);
    await expect(service.dispatch({ type: "overlay.visibility", visible: true })).rejects.toThrow("Take a valid set");
    await load(service);
    await expect(service.dispatch({ type: "overlay.visibility", visible: true })).rejects.toThrow("Take a valid set");
    expect(service.getState().operator.presentation.overlayVisible).toBe(false);
    await take(service);
    expect(service.getState().operator.presentation.overlayVisible).toBe(true);
    expect(store.state?.presentation.overlayVisible).toBe(true);
  });

  it("persists metadata and hidden output through polling, presentation changes and restart", async () => {
    const { service, store } = create();
    await establishHistory(service);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    await service.dispatch({ type: "presentation.metadata", fields: ["country", "social"] });
    await service.dispatch({ type: "presentation.swap" });
    await service.dispatch({ type: "overlay.select", templateId: "minimal" });
    await service.dispatch({ type: "presentation.clear" });
    await load(service, "event-2");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(service.getState().operator.presentation).toEqual({
      sideOrder: "normal",
      overlayTemplateId: "minimal",
      metadataFields: ["country", "social"],
      overlayVisible: false,
    });
    expect(service.getState().overlay.metadataFields).toEqual(["country", "social"]);
    expect(service.getState().overlay.setId).toBe("group-1-b");
    expect(service.getState().liveConnection.status).toBe("fresh");
    const expected = structuredClone(service.getState().operator);
    service.close();

    const restored = create(fixtureProvider(), store).service;
    const snapshots: ServerState[] = [];
    restored.subscribe((state) => { snapshots.push(state); });
    await restored.initialize();
    expect(restored.getState().operator).toEqual(expected);
    expect(restored.getState().overlay).toMatchObject({ eventName: "event-1", setId: "group-1-b", metadataFields: ["country", "social"] });
    expect(snapshots.filter((state) => state.overlay.setId !== null).every((state) => !state.operator.presentation.overlayVisible)).toBe(true);
    await restored.dispatch({ type: "overlay.visibility", visible: true });
    expect(restored.getState().operator.previousLiveSelection).toEqual(expected.previousLiveSelection);
    expect(store.state?.presentation.overlayVisible).toBe(true);
    await restored.dispatch({ type: "presentation.metadata", fields: [] });
    expect(store.state?.presentation.metadataFields).toEqual([]);
    expect(restored.getState().overlay.metadataFields).toEqual([]);
  });

  it("never unhides when a failed hidden startup scene subsequently recovers", async () => {
    const { service, store } = create();
    await establishHistory(service);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    service.close();
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider)).mockRejectedValueOnce(new Error("Offline"));
    const restored = create({ ...provider, loadSet }, store).service;
    await expect(restored.initialize()).rejects.toThrow("Offline");
    await expect(restored.dispatch({ type: "overlay.visibility", visible: true })).rejects.toThrow("Take a valid set");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(restored.getState()).toMatchObject({
      overlay: { setId: "group-1-b" },
      operator: { presentation: { overlayVisible: false }, previousLiveSelection: { setId: "group-1-a" } },
      liveConnection: { status: "fresh" },
    });
    expect(store.state?.presentation.overlayVisible).toBe(false);
  });

  it("keeps the output hidden in memory and explicitly reports a failed visibility save", async () => {
    const { service, store } = create();
    await establishHistory(service);
    vi.spyOn(store, "save").mockRejectedValueOnce(new Error("Disk full"));
    await expect(service.dispatch({ type: "overlay.visibility", visible: false })).rejects.toMatchObject({ code: "persistence_failed" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getState().operator.presentation.overlayVisible).toBe(false);
  });
});

describe("atomic previous-live restoration", () => {
  it("loads current provider data and swaps history across events without replacing the preview", async () => {
    const provider = fixtureProvider();
    let score = 0;
    const loadSet = vi.fn(async (...args: Parameters<TournamentDataProvider["loadSet"]>) => {
      const set = await provider.loadSet(...args);
      const withScore = (slot: NormalizedSet["entrants"][number]) => slot === null ? null : { ...slot, score };
      return { ...set, entrants: [withScore(set.entrants[0]), withScore(set.entrants[1])] as const };
    });
    const { service, store } = create({ ...provider, loadSet });
    await load(service);
    await take(service);
    const first = service.getState().operator.liveSelection;
    await load(service, "event-2");
    await take(service, "group-1-a", "event-2");
    const second = service.getState().operator.liveSelection;
    expect(service.getState().operator.previousLiveSelection).toEqual(first);
    await load(service, "event-3");
    await service.dispatch({ type: "set.select", setId: "group-1-b" });
    const preview = service.getState().event;
    const previewSelection = service.getState().operator.selectedSetId;
    await service.dispatch({ type: "overlay.visibility", visible: false });
    score = 3;
    const snapshots: ServerState[] = [];
    service.subscribe((state) => { snapshots.push(state); });

    await service.dispatch({ type: "live.restore" });
    expect(service.getState().operator).toMatchObject({
      liveSelection: first,
      previousLiveSelection: second,
      selectedSetId: previewSelection,
      presentation: { overlayVisible: true },
    });
    expect(service.getState().event).toBe(preview);
    expect(service.getState().overlay.players[0]?.score).toBe(3);
    expect(snapshots.slice(1).every((state) =>
      state.overlay.eventName === "event-1" &&
      state.operator.presentation.overlayVisible &&
      state.operator.previousLiveSelection?.eventInput === second?.eventInput,
    )).toBe(true);
    expect(store.state?.previousLiveSelection).toEqual(second);
    await service.dispatch({ type: "live.restore" });
    expect(service.getState().operator.liveSelection).toEqual(second);
    expect(service.getState().operator.previousLiveSelection).toEqual(first);
    expect(service.getState().event).toBe(preview);
  });

  it("retains history when the same set is taken again and makes the overlay visible", async () => {
    const { service, store } = create();
    await establishHistory(service);
    const history = service.getState().operator.previousLiveSelection;
    await service.dispatch({ type: "overlay.visibility", visible: false });
    await take(service, "group-1-b");
    expect(service.getState().operator.previousLiveSelection).toEqual(history);
    expect(service.getState().operator.presentation.overlayVisible).toBe(true);
    expect(store.state?.previousLiveSelection).toEqual(history);
  });

  it("recognizes the same live event after a saved input is resolved to its canonical slug", async () => {
    const { service, store } = create();
    await establishHistory(service);
    const operator = service.getState().operator;
    const history = operator.previousLiveSelection;
    store.state = { ...operator, liveSelection: { ...operator.liveSelection!, eventInput: "event-1" } };
    service.close();
    const restored = create(fixtureProvider(), store).service;
    await restored.initialize();
    await take(restored, "group-1-b");
    expect(restored.getState().operator.previousLiveSelection).toEqual(history);
    expect(store.state?.previousLiveSelection).toEqual(history);
  });

  it.each(["live.take", "live.restore"] as const)("preserves the scene, hidden state and history when %s fails", async (type) => {
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const { service, store } = create({ ...provider, loadSet });
    await establishHistory(service);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    const before = air(service.getState());
    const saved = structuredClone(store.state);
    const revision = service.getState().revision;
    loadSet.mockRejectedValueOnce(new ProviderError("request_timeout", "Timed out"));
    const command: ClientCommand = type === "live.take"
      ? { type, setId: "group-1-a", eventId: "event-1" }
      : { type };
    await expect(service.dispatch(command)).rejects.toThrow("Timed out");
    expect(air(service.getState())).toEqual(before);
    expect(store.state).toEqual(saved);
    expect(service.getState().revision).toBe(revision);
  });

  it("rejects a restore with no history without changing the current scene", async () => {
    const { service } = create();
    await load(service);
    await take(service);
    const before = air(service.getState());
    await expect(service.dispatch({ type: "live.restore" })).rejects.toThrow("no previous live set");
    expect(air(service.getState())).toEqual(before);
  });

  it.each(["metadata", "group", "missing-set", "wrong-set"] as const)("preserves the current hidden scene when restore fails during %s", async (failure) => {
    const provider = fixtureProvider();
    const metadata = vi.fn(provider.loadEvent.bind(provider));
    const groups = vi.fn(provider.loadPhaseGroupSets.bind(provider));
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const { service } = create({ ...provider, loadEvent: metadata, loadPhaseGroupSets: groups, loadSet });
    await establishHistory(service);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    const before = air(service.getState());
    if (failure === "metadata") metadata.mockRejectedValueOnce(new Error("Offline"));
    if (failure === "group") metadata.mockResolvedValueOnce({ ...fixtureEvent(), phaseGroups: [] });
    if (failure === "missing-set") groups.mockResolvedValueOnce([]);
    if (failure === "wrong-set") loadSet.mockResolvedValueOnce(fixtureSet("wrong-set"));
    await expect(service.dispatch({ type: "live.restore" })).rejects.toThrow();
    expect(air(service.getState())).toEqual(before);
  });
});

describe("broadcast-operation cancellation", () => {
  it.each(["live.take", "live.restore"] as const)("hiding cancels a delayed %s even when its provider ignores abort", async (type) => {
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const { service, store } = create({ ...provider, loadSet });
    await establishHistory(service);
    let signal: AbortSignal | undefined;
    let finish: ((set: NormalizedSet) => void) | undefined;
    loadSet.mockImplementationOnce((_id, _event, options) => {
      signal = options?.signal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const command: ClientCommand = type === "live.take"
      ? { type, setId: "group-1-a", eventId: "event-1" }
      : { type };
    const pending = service.dispatch(command);
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    expect(signal?.aborted).toBe(true);
    const before = air(service.getState());
    await cancelled;
    finish?.(fixtureSet("group-1-a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(air(service.getState())).toEqual(before);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.getState().overlay.setId).toBe("group-1-b");
    expect(service.getState().operator.presentation.overlayVisible).toBe(false);
    expect(store.state?.presentation.overlayVisible).toBe(false);
  });

  it("cancels restore during metadata loading without requesting more data or publishing a provider error", async () => {
    const provider = fixtureProvider();
    const metadata = vi.fn(provider.loadEvent.bind(provider));
    const groups = vi.fn(provider.loadPhaseGroupSets.bind(provider));
    const { service } = create({ ...provider, loadEvent: metadata, loadPhaseGroupSets: groups });
    await establishHistory(service);
    let fail: ((error: Error) => void) | undefined;
    metadata.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const pending = service.dispatch({ type: "live.restore" });
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    fail?.(new Error("Provider's generic cancellation message"));
    await cancelled;
    expect(groups).toHaveBeenCalledTimes(1);
    expect(service.getState().liveConnection.status).toBe("fresh");
    expect(service.getState().operator.presentation.overlayVisible).toBe(false);
  });

  it.each(["live.take", "live.restore"] as const)("a newer %s supersedes an old take without letting its late result change history", async (type) => {
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const { service, store } = create({ ...provider, loadSet });
    await establishHistory(service);
    let finish: ((set: NormalizedSet) => void) | undefined;
    loadSet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = take(service, "group-1-b");
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    await service.dispatch(type === "live.take"
      ? { type, setId: "group-1-a", eventId: "event-1" }
      : { type });
    const before = air(service.getState());
    finish?.(fixtureSet("group-1-b", "group-1", 99));
    await cancelled;
    expect(air(service.getState())).toEqual(before);
    expect(store.state?.liveSelection?.setId).toBe("group-1-a");
    expect(store.state?.previousLiveSelection?.setId).toBe("group-1-b");
  });

  it("allows a new take after hiding while preventing a previously cancelled restore from returning", async () => {
    const provider = fixtureProvider();
    const loadSet = vi.fn(provider.loadSet.bind(provider));
    const { service, store } = create({ ...provider, loadSet });
    await establishHistory(service);
    let finish: ((set: NormalizedSet) => void) | undefined;
    loadSet.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.dispatch({ type: "live.restore" });
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    await service.dispatch({ type: "overlay.visibility", visible: false });
    await take(service, "group-1-b");
    finish?.(fixtureSet("group-1-a"));
    await cancelled;
    expect(service.getState().operator.presentation.overlayVisible).toBe(true);
    expect(service.getState().overlay.setId).toBe("group-1-b");
    expect(store.state?.liveSelection?.setId).toBe("group-1-b");
    expect(store.state?.previousLiveSelection?.setId).toBe("group-1-a");
  });
});
