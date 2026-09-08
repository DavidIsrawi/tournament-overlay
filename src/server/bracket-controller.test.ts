import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry, type TournamentDataProvider } from "../providers/index.ts";
import type { NormalizedSet } from "../shared/contracts.ts";
import { BracketController, type BracketStateAccess } from "./bracket-controller.ts";
import { fixtureEvent, fixtureProvider, fixtureSet } from "./fixtures.test-support.ts";
import { IDLE_CONNECTION } from "./provider-recovery.ts";

const controllers: BracketController[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
});

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.close());
  vi.useRealTimers();
});

function create(provider: TournamentDataProvider = fixtureProvider()) {
  let state: ReturnType<BracketStateAccess["get"]> = {
    selection: { providerId: "startgg", eventInput: "", selectedPhaseGroupId: null, selectedSetId: null },
    event: null,
    connection: IDLE_CONNECTION,
  };
  const save = vi.fn(() => Promise.resolve());
  const publish = vi.fn((patch: Parameters<BracketStateAccess["publish"]>[0]) => {
    state = { ...state, ...patch };
  });
  const controller = new BracketController(
    new ProviderRegistry([provider]),
    { get: () => state, publish, save },
    1_000,
    10_000,
  );
  controllers.push(controller);
  return { controller, save, publish, get state() { return state; } };
}

async function load(controller: BracketController): Promise<void> {
  await controller.loadEvent("startgg", fixtureEvent().slug, false);
}

describe("bracket request ownership", () => {
  it.each(["phase", "set", "event", "close"] as const)(
    "does not let a cached cross-phase selection overwrite a newer %s operation after saving",
    async (action) => {
      const context = create();
      const { controller, save } = context;
      await load(controller);
      await controller.selectPhaseGroup("group-2");
      const writing = Promise.withResolvers<void>();
      save.mockImplementationOnce(() => writing.promise);
      const selecting = controller.selectSet("group-1-b");
      const cancelled = expect(selecting).rejects.toMatchObject({ name: "AbortError" });

      if (action === "phase") {
        await controller.selectPhaseGroup("group-2");
      } else if (action === "set") {
        await controller.selectSet("group-1-a");
      } else if (action === "event") {
        await controller.loadEvent("startgg", fixtureEvent("event-2").slug, false);
      } else {
        controller.close();
      }
      const latest = context.state;
      const writes = save.mock.calls.length;
      writing.resolve();
      await cancelled;
      expect(context.state).toBe(latest);
      expect(save).toHaveBeenCalledTimes(writes);
    },
  );

  it("does not request uncached sets after the selection is cancelled during persistence", async () => {
    const provider = fixtureProvider();
    const groups = vi.fn(provider.loadPhaseGroupSets.bind(provider));
    const { controller, save } = create({ ...provider, loadPhaseGroupSets: groups });
    await load(controller);
    const writing = Promise.withResolvers<void>();
    save.mockImplementationOnce(() => writing.promise);
    const pending = controller.selectPhaseGroup("group-2");
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.invalidate();
    writing.resolve();
    await cancelled;
    expect(groups).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(groups).toHaveBeenCalledTimes(1);
  });

  it("ignores late progress and results after invalidation even if a provider ignores abort", async () => {
    const provider = fixtureProvider();
    const loading = Promise.withResolvers<readonly NormalizedSet[]>();
    let options: Parameters<TournamentDataProvider["loadPhaseGroupSets"]>[2];
    const context = create({
      ...provider,
      loadPhaseGroupSets: (_id, _name, requestOptions) => {
        options = requestOptions;
        return loading.promise;
      },
    });
    const pending = load(context.controller);
    const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    context.controller.invalidate();
    const latest = context.state;
    options?.onProgress?.({ loadedPages: 1, totalPages: 1, sets: [fixtureSet("obsolete")] });
    loading.resolve([fixtureSet("obsolete")]);
    await cancelled;
    expect(options?.signal?.aborted).toBe(true);
    expect(context.state).toBe(latest);
    expect(context.save).not.toHaveBeenCalled();
  });

  it("lets preview selection coexist with an in-flight partial bracket load", async () => {
    const provider = fixtureProvider();
    const loading = Promise.withResolvers<readonly NormalizedSet[]>();
    let signal: AbortSignal | undefined;
    const context = create({
      ...provider,
      loadPhaseGroupSets: (_id, _name, options) => {
        signal = options?.signal;
        options?.onProgress?.({ loadedPages: 1, totalPages: 2, sets: [fixtureSet("partial")] });
        return loading.promise;
      },
    });
    const pending = load(context.controller);
    await vi.advanceTimersByTimeAsync(0);
    await context.controller.selectSet("partial");
    expect(signal?.aborted).toBe(false);
    expect(context.state.connection.status).toBe("loading");
    loading.resolve([fixtureSet("partial"), fixtureSet("remaining")]);
    await pending;
    expect(context.state.selection.selectedSetId).toBe("partial");
    expect(context.state.event?.phaseGroups[0]?.sets).toHaveLength(2);
    expect(context.state.connection.status).toBe("fresh");
  });

  it("rejects a set removed by its phase reload instead of persisting a dangling selection", async () => {
    const provider = fixtureProvider();
    const groups = vi.fn(provider.loadPhaseGroupSets.bind(provider));
    const context = create({ ...provider, loadPhaseGroupSets: groups });
    await load(context.controller);
    await context.controller.selectPhaseGroup("group-2");
    vi.setSystemTime(new Date("2026-09-07T12:01:00Z"));
    groups.mockResolvedValueOnce([fixtureSet("group-1-a")]);
    await expect(context.controller.selectSet("group-1-b")).rejects.toMatchObject({ code: "set_not_found" });
    expect(context.state.selection.selectedSetId).toBe("group-1-a");
  });
});
