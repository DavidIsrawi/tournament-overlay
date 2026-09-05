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

  public async take(event: NormalizedEvent, setId: string): Promise<void> {
    if (this.#closed) {
      throw new Error("The live scene is closed.");
    }
    const controller = new AbortController();
    this.#takeController?.abort();
    this.#takeController = controller;
    try {
      const set = await this.providers.get(event.providerId).loadSet(setId, event, {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (set.id !== setId) {
        throw new ProviderError("invalid_response", "The provider returned a different set.");
      }
      this.#cancelPoll();
      this.#event = event;
      this.#set = set;
      this.#selection = {
        providerId: event.providerId,
        eventInput: event.slug,
        phaseGroupId: set.phaseGroupId,
        setId,
      };
      this.#markFresh();
      this.#schedule(this.interval);
    } finally {
      if (this.#takeController === controller) {
        this.#takeController = null;
      }
    }
  }

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
      const provider = this.providers.get(selection.providerId);
      let event = await provider.loadEvent(selection.eventInput, { signal: controller.signal });
      const group = event.phaseGroups.find((candidate) => candidate.id === selection.phaseGroupId);
      if (group === undefined) {
        throw new ProviderError("phase_group_not_found", "The saved live phase group is no longer available.");
      }
      const sets = await provider.loadPhaseGroupSets(group.id, group.phaseName, { signal: controller.signal });
      event = {
        ...event,
        phaseGroups: event.phaseGroups.map((candidate) => candidate.id === group.id
          ? { ...candidate, sets, setsLoaded: true, setsFetchedAt: new Date().toISOString() }
          : candidate),
      };
      if (findSet(event, selection.setId) === null) {
        throw new ProviderError("set_not_found", "The saved live set is no longer available.");
      }
      const set = await provider.loadSet(selection.setId, event, { signal: controller.signal });
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
    this.#takeController?.abort();
    this.#takeController = null;
    if (!this.#closed && this.#selection !== null) {
      this.#cancelPoll();
      this.#schedule(0);
    }
  }

  public close(): void {
    this.#closed = true;
    this.#cancelPoll();
    this.#takeController?.abort();
    this.#takeController = null;
  }

  #emit(): void {
    this.publish({
      event: this.#event,
      set: this.#set,
      selection: this.#selection,
      connection: this.#connection,
    });
  }

  #markFresh(): void {
    this.#connection = {
      status: "fresh",
      message: null,
      lastUpdatedAt: new Date().toISOString(),
      nextPollAt: new Date(Date.now() + this.interval).toISOString(),
      failureCount: 0,
    };
    this.#emit();
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
