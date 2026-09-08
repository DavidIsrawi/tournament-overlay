import {
  ProviderError,
  type PhaseGroupLoadProgress,
  type ProviderRegistry,
  type TournamentDataProvider,
} from "../providers/index.ts";
import {
  findSet,
  type ConnectionState,
  type NormalizedEvent,
  type NormalizedPhaseGroup,
  type OperatorState,
  type ProviderId,
} from "../shared/contracts.ts";
import {
  mergeCachedPhaseGroups,
  replacePhaseGroupSets,
  resolvePhaseGroupSelection,
  resolveSetSelection,
} from "./bracket-data.ts";
import { canRetry, IDLE_CONNECTION, requestMessage, retryDelay } from "./provider-recovery.ts";

export const BRACKET_REFRESH_INTERVAL_MS = 60_000;

type BracketSelection = Pick<
  OperatorState,
  "providerId" | "eventInput" | "selectedPhaseGroupId" | "selectedSetId"
>;

interface BracketState {
  readonly selection: BracketSelection;
  readonly event: NormalizedEvent | null;
  readonly connection: ConnectionState;
}

// The hub remains authoritative; bracket operations cannot mutate live selections
// or presentation, and saves capture the current complete operator state.
export interface BracketStateAccess {
  readonly get: () => BracketState;
  readonly publish: (patch: Partial<BracketState>) => void;
  readonly save: () => Promise<void>;
}

export class BracketController {
  #pollTimer: NodeJS.Timeout | null = null;
  #generation = 0;
  // Selecting a partial set must not cancel its bracket's remaining pages.
  #selectionGeneration = 0;
  #activeRequestController: AbortController | null = null;
  #closed = false;

  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly state: BracketStateAccess,
    private readonly retryIntervalMs: number,
    private readonly refreshIntervalMs = BRACKET_REFRESH_INTERVAL_MS,
  ) {}

  public invalidate(): void {
    this.#generation += 1;
    this.#selectionGeneration += 1;
    this.#cancelPoll();
    this.#activeRequestController?.abort(this.#superseded());
    this.#activeRequestController = null;
  }

  public close(): void {
    this.#closed = true;
    this.invalidate();
  }

  public async loadEvent(
    providerId: ProviderId,
    input: string,
    preserveSelection: boolean,
  ): Promise<void> {
    const controller = this.#beginRequest();
    const generation = this.#generation;
    const previous = this.state.get();
    const loadingSelection: BracketSelection = {
      providerId,
      eventInput: input.trim(),
      selectedPhaseGroupId: preserveSelection ? previous.selection.selectedPhaseGroupId : null,
      selectedSetId: preserveSelection ? previous.selection.selectedSetId : null,
    };
    this.state.publish({
      selection: loadingSelection,
      event: preserveSelection ? previous.event : null,
      connection: {
        ...(preserveSelection ? previous.connection : IDLE_CONNECTION),
        status: "loading",
        message: "Loading event metadata\u2026",
        nextPollAt: null,
      },
    });

    try {
      const provider = this.providers.get(providerId);
      const metadata = await provider.loadEvent(input, { signal: controller.signal });
      this.#assertCurrent(generation);
      let event = mergeCachedPhaseGroups(metadata, preserveSelection ? previous.event : null);
      const selectedPhaseGroupId = resolvePhaseGroupSelection(event, loadingSelection.selectedPhaseGroupId);
      const selectedSetId = resolveSetSelection(event, selectedPhaseGroupId, loadingSelection.selectedSetId);
      this.state.publish({
        selection: { providerId, eventInput: event.slug, selectedPhaseGroupId, selectedSetId },
        event,
        connection: {
          ...this.state.get().connection,
          status: "loading",
          message: this.#loadingMessage(event, selectedPhaseGroupId),
          nextPollAt: null,
        },
      });

      const group = event.phaseGroups.find((candidate) => candidate.id === selectedPhaseGroupId);
      if (group !== undefined) {
        event = await this.#loadPhaseGroup(provider, event, group, generation, controller.signal);
      }
      this.#assertCurrent(generation);
      this.state.publish({
        selection: {
          providerId,
          eventInput: event.slug,
          selectedPhaseGroupId,
          selectedSetId: resolveSetSelection(event, selectedPhaseGroupId, this.state.get().selection.selectedSetId),
        },
        event,
        connection: {
          status: "fresh",
          message: null,
          lastUpdatedAt: new Date().toISOString(),
          nextPollAt: selectedPhaseGroupId === null ? null : this.#nextPollAt(),
          failureCount: 0,
        },
      });
      await this.state.save();
      this.#assertCurrent(generation);
      this.#scheduleRefresh(this.refreshIntervalMs, generation);
    } catch (error) {
      if (generation === this.#generation) {
        this.#failed(error, generation, () => this.loadEvent(providerId, input, true));
      }
      throw error;
    } finally {
      this.#clearActiveRequest(controller);
    }
  }

  public async selectPhaseGroup(phaseGroupId: string, force = false): Promise<void> {
    const state = this.state.get();
    const event = state.event;
    const group = event?.phaseGroups.find((candidate) => candidate.id === phaseGroupId);
    if (event === null || group === undefined) {
      throw new ProviderError("phase_group_not_found", `Phase group "${phaseGroupId}" is not available.`);
    }
    const controller = this.#beginRequest();
    const generation = this.#generation;
    const age = group.setsFetchedAt === null
      ? Number.POSITIVE_INFINITY
      : Date.now() - Date.parse(group.setsFetchedAt);
    const useCache = !force && group.setsLoaded && age < this.refreshIntervalMs;
    this.state.publish({
      selection: {
        ...state.selection,
        selectedPhaseGroupId: group.id,
        selectedSetId: group.setsLoaded
          ? resolveSetSelection(event, group.id,
            state.selection.selectedPhaseGroupId === group.id ? state.selection.selectedSetId : null)
          : null,
      },
      connection: useCache
        ? {
            ...state.connection,
            status: "fresh",
            message: null,
            lastUpdatedAt: group.setsFetchedAt,
            nextPollAt: new Date(Date.now() + this.refreshIntervalMs - age).toISOString(),
            failureCount: 0,
          }
        : {
            ...state.connection,
            status: "loading",
            lastUpdatedAt: group.setsFetchedAt,
            message: this.#loadingMessage(event, group.id),
            nextPollAt: null,
          },
    });
    try {
      await this.state.save();
      this.#assertCurrent(generation);
      if (useCache) {
        this.#scheduleRefresh(this.refreshIntervalMs - age, generation);
        return;
      }
      const provider = this.providers.get(state.selection.providerId);
      const loadedEvent = await this.#loadPhaseGroup(provider, event, group, generation, controller.signal);
      this.#assertCurrent(generation);
      this.state.publish({
        selection: {
          ...this.state.get().selection,
          selectedPhaseGroupId: group.id,
          selectedSetId: resolveSetSelection(loadedEvent, group.id, this.state.get().selection.selectedSetId),
        },
        event: loadedEvent,
        connection: {
          status: "fresh",
          message: null,
          lastUpdatedAt: new Date().toISOString(),
          nextPollAt: this.#nextPollAt(),
          failureCount: 0,
        },
      });
      await this.state.save();
      this.#assertCurrent(generation);
      this.#scheduleRefresh(this.refreshIntervalMs, generation);
    } catch (error) {
      if (generation === this.#generation) {
        this.#failed(error, generation);
      }
      throw error;
    } finally {
      this.#clearActiveRequest(controller);
    }
  }

  public async selectSet(setId: string): Promise<void> {
    const state = this.state.get();
    const set = findSet(state.event, setId);
    if (set === null) {
      throw new ProviderError("set_not_found", `Set "${setId}" is not available.`);
    }
    let selectionGeneration = ++this.#selectionGeneration;
    if (set.phaseGroupId !== state.selection.selectedPhaseGroupId) {
      const switching = this.selectPhaseGroup(set.phaseGroupId);
      selectionGeneration = this.#selectionGeneration;
      await switching;
    }
    if (this.#closed || selectionGeneration !== this.#selectionGeneration) {
      throw this.#superseded();
    }
    const current = this.state.get();
    if (findSet(current.event, set.id) === null) {
      throw new ProviderError("set_not_found", `Set "${setId}" is no longer available.`);
    }
    this.state.publish({
      selection: { ...current.selection, selectedPhaseGroupId: set.phaseGroupId, selectedSetId: set.id },
    });
    await this.state.save();
  }

  #failed(error: unknown, generation: number, retry?: () => Promise<void>): void {
    const current = this.state.get();
    const failureCount = current.connection.failureCount + 1;
    const delay = retryDelay(this.retryIntervalMs, failureCount);
    const retryable = canRetry(error);
    this.state.publish({
      connection: {
        ...current.connection,
        status: current.event === null ? "error" : "stale",
        message: error instanceof ProviderError ? error.message
          : error instanceof Error ? `Provider request failed: ${error.message}`
            : "Provider request failed with an unknown error.",
        nextPollAt: retryable ? new Date(Date.now() + delay).toISOString() : null,
        failureCount,
      },
    });
    if (retryable) {
      this.#scheduleRefresh(delay, generation, retry);
    }
  }

  #scheduleRefresh(delayMs: number, generation: number, retry?: () => Promise<void>): void {
    if (this.#closed || generation !== this.#generation) {
      return;
    }
    this.#cancelPoll();
    const groupId = this.state.get().selection.selectedPhaseGroupId;
    if (retry === undefined && groupId === null) {
      return;
    }
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      const refresh = retry ?? (() => groupId === null
        ? Promise.reject(new Error("No phase group is selected."))
        : this.selectPhaseGroup(groupId, true));
      void refresh().catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          console.warn("Scheduled bracket refresh failed:", requestMessage(error));
        }
      });
    }, delayMs);
  }

  async #loadPhaseGroup(
    provider: TournamentDataProvider,
    event: NormalizedEvent,
    group: NormalizedPhaseGroup,
    generation: number,
    signal: AbortSignal,
  ): Promise<NormalizedEvent> {
    const sets = await provider.loadPhaseGroupSets(group.id, group.phaseName, {
      signal,
      onProgress: (progress) => this.#publishProgress(event.id, group, generation, progress),
    });
    this.#assertCurrent(generation);
    const current = this.state.get().event;
    const base = current?.id === event.id && current.providerId === event.providerId ? current : event;
    return replacePhaseGroupSets(base, group.id, sets, true);
  }

  #publishProgress(
    eventId: string,
    group: NormalizedPhaseGroup,
    generation: number,
    progress: PhaseGroupLoadProgress,
  ): void {
    const state = this.state.get();
    if (generation !== this.#generation || state.event?.id !== eventId) {
      return;
    }
    this.state.publish({
      event: group.setsLoaded
        ? state.event
        : replacePhaseGroupSets(state.event, group.id, progress.sets, false),
      connection: {
        ...state.connection,
        status: "loading",
        message: `Loading ${group.phaseName}: page ${String(progress.loadedPages)} of ${String(progress.totalPages)} (${String(progress.sets.length)} sets)\u2026`,
        nextPollAt: null,
      },
    });
  }

  #beginRequest(): AbortController {
    if (this.#closed) {
      throw new Error("Bracket controller is closed.");
    }
    this.invalidate();
    const controller = new AbortController();
    this.#activeRequestController = controller;
    return controller;
  }

  #assertCurrent(generation: number): void {
    if (this.#closed || generation !== this.#generation) {
      throw this.#superseded();
    }
  }

  #superseded(): DOMException {
    return new DOMException("The request was superseded.", "AbortError");
  }

  #cancelPoll(): void {
    if (this.#pollTimer !== null) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #clearActiveRequest(controller: AbortController): void {
    if (this.#activeRequestController === controller) {
      this.#activeRequestController = null;
    }
  }

  #nextPollAt(): string {
    return new Date(Date.now() + this.refreshIntervalMs).toISOString();
  }

  #loadingMessage(event: NormalizedEvent, phaseGroupId: string | null): string {
    const group = event.phaseGroups.find((candidate) => candidate.id === phaseGroupId);
    return group === undefined ? "Event metadata loaded." : `Loading ${group.phaseName} bracket\u2026`;
  }
}
