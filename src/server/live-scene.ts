import {
  ProviderError,
  type ProviderRegistry,
} from "../providers/index.ts";
import {
  findSet,
  type ConnectionState,
  type LiveSelection,
  type NormalizedEvent,
  type NormalizedSet,
} from "../shared/contracts.ts";

export const IDLE_CONNECTION: ConnectionState = {
  status: "idle",
  message: null,
  lastUpdatedAt: null,
  nextPollAt: null,
  failureCount: 0,
};

export function requestMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The provider request failed.";
}

export function retryDelay(interval: number, failures: number): number {
  return Math.min(interval * 2 ** Math.min(failures, 10), 120_000);
}

export function canRetry(error: unknown): boolean {
  return !(error instanceof ProviderError) || ![
    "missing_token",
    "invalid_event",
    "unknown_provider",
    "event_not_found",
    "set_not_found",
    "phase_group_not_found",
    "persistence_failed",
  ].includes(error.code);
}

interface LiveSceneSnapshot {
  readonly event: NormalizedEvent | null;
  readonly set: NormalizedSet | null;
  readonly selection: LiveSelection | null;
  readonly connection: ConnectionState;
  readonly taken: boolean;
}

// Browsing must never cancel, replace, or determine the freshness of this scene.
export class LiveScene {
  #event: NormalizedEvent | null = null;
  #set: NormalizedSet | null = null;
  #selection: LiveSelection | null = null;
  #connection: ConnectionState = IDLE_CONNECTION;
  #timer: NodeJS.Timeout | null = null;
  #pollController: AbortController | null = null;
  #takeController: AbortController | null = null;
  #closed = false;

  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly interval: number,
    private readonly publish: (scene: LiveSceneSnapshot) => void,
  ) {}

  public take(event: NormalizedEvent, setId: string): Promise<void> {
    return this.#takeScene(async (signal) => {
      const set = await this.providers.get(event.providerId).loadSet(setId, event, { signal });
      signal.throwIfAborted();
      this.#validateSet(set, setId, findSet(event, setId)?.phaseGroupId);
      return { event, set };
    });
  }

  public takeSelection(selection: LiveSelection): Promise<void> {
    return this.#takeScene((signal) => this.#loadSelection(selection, signal));
  }

  async #takeScene(
    load: (signal: AbortSignal) => Promise<{ event: NormalizedEvent; set: NormalizedSet }>,
  ): Promise<void> {
    const controller = this.#beginTake();
    const cancellation = Promise.withResolvers<never>();
    const onAbort = (): void => { cancellation.reject(controller.signal.reason); };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    try {
      // Finish the command promptly even if a provider ignores cancellation.
      // Loading cannot publish; only this guarded continuation may replace air.
      const { event, set } = await Promise.race([load(controller.signal), cancellation.promise]);
      controller.signal.throwIfAborted();
      this.#acceptTake(event, set);
    } catch (error) {
      controller.signal.throwIfAborted();
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      if (this.#takeController === controller) {
        this.#takeController = null;
      }
    }
  }

  public cancelTake(): void {
    this.#takeController?.abort(new DOMException("The request was superseded.", "AbortError"));
    this.#takeController = null;
  }

  #beginTake(): AbortController {
    if (this.#closed) {
      throw new Error("The live scene is closed.");
    }
    this.cancelTake();
    const controller = new AbortController();
    this.#takeController = controller;
    return controller;
  }

  #acceptTake(event: NormalizedEvent, set: NormalizedSet): void {
    this.#cancelPoll();
    this.#event = event;
    this.#set = set;
    this.#selection = {
      providerId: event.providerId,
      eventInput: event.slug,
      phaseGroupId: set.phaseGroupId,
      setId: set.id,
    };
    this.#markFresh(true);
    this.#schedule(this.interval);
  }

  async #loadSelection(
    selection: LiveSelection,
    signal: AbortSignal,
  ): Promise<{ event: NormalizedEvent; set: NormalizedSet }> {
    const provider = this.providers.get(selection.providerId);
    let event = await provider.loadEvent(selection.eventInput, { signal });
    signal.throwIfAborted();
    const group = event.phaseGroups.find((candidate) => candidate.id === selection.phaseGroupId);
    if (group === undefined) {
      throw new ProviderError("phase_group_not_found", "The saved live phase group is no longer available.");
    }
    const sets = await provider.loadPhaseGroupSets(group.id, group.phaseName, { signal });
    signal.throwIfAborted();
    event = {
      ...event,
      phaseGroups: event.phaseGroups.map((candidate) => candidate.id === group.id
        ? { ...candidate, sets, setsLoaded: true, setsFetchedAt: new Date().toISOString() }
        : candidate),
    };
    if (findSet(event, selection.setId) === null) {
      throw new ProviderError("set_not_found", "The saved live set is no longer available.");
    }
    const set = await provider.loadSet(selection.setId, event, { signal });
    signal.throwIfAborted();
    this.#validateSet(set, selection.setId, selection.phaseGroupId);
    return { event, set };
  }

  #validateSet(set: NormalizedSet, setId: string, phaseGroupId?: string): void {
    if (set.id !== setId || (phaseGroupId !== undefined && set.phaseGroupId !== phaseGroupId)) {
      throw new ProviderError("invalid_response", "The provider returned a different set.");
    }
  }

  // Startup recovery may publish the saved selection before loading; operator
  // restores use takeSelection instead so a failed request cannot replace air.
  public async restore(selection: LiveSelection): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#cancelPoll();
    this.#selection = selection;
    const controller = new AbortController();
    this.#pollController = controller;
    this.#connection = { ...this.#connection, status: "loading", nextPollAt: null };
    this.#emit();
    try {
      const { event, set } = await this.#loadSelection(selection, controller.signal);
      controller.signal.throwIfAborted();
      this.#event = event;
      this.#set = set;
      this.#markFresh();
      this.#schedule(this.interval);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.#failed(error);
        throw error;
      }
    } finally {
      if (this.#pollController === controller) {
        this.#pollController = null;
      }
    }
  }

  public refresh(): void {
    this.cancelTake();
    if (!this.#closed && this.#selection !== null) {
      this.#cancelPoll();
      this.#schedule(0);
    }
  }

  public close(): void {
    this.#closed = true;
    this.#cancelPoll();
    this.cancelTake();
  }

  #emit(taken = false): void {
    this.publish({
      event: this.#event,
      set: this.#set,
      selection: this.#selection,
      connection: this.#connection,
      taken,
    });
  }

  #markFresh(taken = false): void {
    this.#connection = {
      status: "fresh",
      message: null,
      lastUpdatedAt: new Date().toISOString(),
      nextPollAt: new Date(Date.now() + this.interval).toISOString(),
      failureCount: 0,
    };
    this.#emit(taken);
  }

  #failed(error: unknown): void {
    const failureCount = this.#connection.failureCount + 1;
    const delay = retryDelay(this.interval, failureCount);
    const retry = canRetry(error);
    this.#connection = {
      ...this.#connection,
      status: this.#set === null ? "error" : "stale",
      message: requestMessage(error),
      nextPollAt: retry ? new Date(Date.now() + delay).toISOString() : null,
      failureCount,
    };
    this.#emit();
    if (retry) {
      this.#schedule(delay);
    }
  }

  #cancelPoll(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#pollController?.abort();
    this.#pollController = null;
  }

  #schedule(delay: number): void {
    if (this.#closed) {
      return;
    }
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#poll();
    }, delay);
  }

  async #poll(): Promise<void> {
    const selection = this.#selection;
    if (this.#closed || selection === null) {
      return;
    }
    if (this.#event === null || this.#set === null) {
      try {
        await this.restore(selection);
      } catch (error) {
        // restore has published the failure and scheduled its next retry.
        console.warn("Live scene restore failed:", requestMessage(error));
      }
      return;
    }
    const controller = new AbortController();
    this.#pollController = controller;
    try {
      const set = await this.providers.get(selection.providerId).loadSet(
        selection.setId,
        this.#event,
        { signal: controller.signal },
      );
      controller.signal.throwIfAborted();
      this.#validateSet(set, selection.setId, selection.phaseGroupId);
      this.#set = set;
      this.#markFresh();
      this.#schedule(this.interval);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.#failed(error);
      }
    } finally {
      if (this.#pollController === controller) {
        this.#pollController = null;
      }
    }
  }
}
