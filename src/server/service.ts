import {
  PROTOCOL_VERSION,
  deriveOverlayView,
  findSet,
  type ClientCommand,
  type ConnectionState,
  type NormalizedEvent,
  type NormalizedPhaseGroup,
  type NormalizedSet,
  type OperatorState,
  type ProviderId,
  type ServerState,
} from "../shared/contracts.ts";
import {
  ProviderError,
  type PhaseGroupLoadProgress,
  type ProviderRegistry,
  type TournamentDataProvider,
} from "../providers/index.ts";
import type { AtomicOperatorStateStore } from "./persistence.ts";
import { StateHub, type StateListener } from "./state-hub.ts";
import { canRetry, IDLE_CONNECTION, LiveScene, requestMessage, retryDelay } from "./live-scene.ts";
import { APP_VERSION } from "../shared/app-info.ts";

export const BRACKET_REFRESH_INTERVAL_MS = 60_000;

const DEFAULT_OPERATOR_STATE: OperatorState = {
  providerId: "startgg",
  eventInput: "",
  selectedPhaseGroupId: null,
  selectedSetId: null,
  liveSelection: null,
  presentation: {
    sideOrder: "normal",
    overlayTemplateId: "octagon",
  },
};

export class TournamentService {
  readonly #hub: StateHub;
  readonly #live: LiveScene;
  #liveEvent: NormalizedEvent | null = null;
  #liveSet: NormalizedSet | null = null;
  #saveQueue: Promise<void> = Promise.resolve();
  #operatorReady: Promise<void> = Promise.resolve();
  #restoreError: Error | null = null;
  #pollTimer: NodeJS.Timeout | null = null;
  #pollGeneration = 0;
  #activeRequestController: AbortController | null = null;
  #closed = false;

  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly store: AtomicOperatorStateStore,
    private readonly pollIntervalMs: number,
    private readonly bracketRefreshIntervalMs = BRACKET_REFRESH_INTERVAL_MS,
  ) {
    const connection: ConnectionState = {
      status: "idle",
      message: null,
      lastUpdatedAt: null,
      nextPollAt: null,
      failureCount: 0,
    };
    this.#hub = new StateHub({
      appVersion: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      startedAt: new Date().toISOString(),
      providers: providers.list(),
      operator: DEFAULT_OPERATOR_STATE,
      connection,
      liveConnection: IDLE_CONNECTION,
      event: null,
      overlay: deriveOverlayView(
        0,
        null,
        null,
        DEFAULT_OPERATOR_STATE.presentation,
        connection.status,
      ),
    });
    this.#live = new LiveScene(providers, pollIntervalMs, (scene) => {
      this.#liveEvent = scene.event;
      this.#liveSet = scene.set;
      const current = this.getState();
      const event = scene.set !== null && current.event !== null &&
        current.event?.id === scene.event?.id &&
        current.event?.providerId === scene.event?.providerId
        ? this.#replaceSet(current.event, scene.set)
        : current.event;
      this.#commit({
        event,
        operator: { ...current.operator, liveSelection: scene.selection },
        liveConnection: scene.connection,
      });
    });
  }

  public getState(): ServerState {
    return this.#hub.get();
  }

  public subscribe(listener: StateListener): () => void {
    return this.#hub.subscribe(listener);
  }

  public replaceProvider(provider: TournamentDataProvider): void {
    if (this.#closed) {
      throw new Error("Tournament service is closed.");
    }
    this.#pollGeneration += 1;
    this.#cancelPoll();
    this.#abortActiveRequest();
    this.providers.replace(provider);
    this.#live.refresh();
    const current = this.getState();
    this.#commit({
      providers: this.providers.list(),
      connection: this.#restoreError !== null ? {
        ...current.connection,
        status: "error",
        message: this.#restoreError.message,
      } : {
        status: current.event === null ? "idle" : "stale",
        message:
          current.event === null
            ? null
            : "Provider settings changed. Refresh to verify the current event.",
        lastUpdatedAt: current.connection.lastUpdatedAt,
        nextPollAt: null,
        failureCount: 0,
      },
    });
  }

  public initialize(): Promise<void> {
    const restore = this.#restoreOperator();
    this.#operatorReady = restore.then(
      () => undefined,
      (error: unknown) => {
        this.#restoreError = new Error(
          `Saved settings could not be restored. No scene changes will be accepted. ${requestMessage(error)}`,
          { cause: error },
        );
        this.#commit({
          connection: {
            ...IDLE_CONNECTION,
            status: "error",
            message: this.#restoreError.message,
          },
        });
      },
    );
    return restore.then(async (operator) => {
      if (operator === null || this.#closed) {
        return;
      }
      await Promise.all([
        operator.eventInput.trim().length > 0
          ? this.loadEvent(operator.providerId, operator.eventInput, true)
          : Promise.resolve(),
        operator.liveSelection === null
          ? Promise.resolve()
          : this.#live.restore(operator.liveSelection),
      ]);
    });
  }

  async #restoreOperator(): Promise<OperatorState | null> {
    const persistedOperator = await this.store.load(DEFAULT_OPERATOR_STATE);
    if (this.#closed) {
      return null;
    }
    const operator = this.providers.has(persistedOperator.providerId)
      ? persistedOperator
      : DEFAULT_OPERATOR_STATE;
    this.#commit({ operator });
    if (operator !== persistedOperator) {
      await this.store.save(operator);
    }
    return operator;
  }

  public dispatch(command: ClientCommand): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("Tournament service is closed."));
    }
    return this.#operatorReady.then(() => {
      if (this.#restoreError !== null) {
        throw this.#restoreError;
      }
      return this.#dispatchCommand(command);
    });
  }

  async #dispatchCommand(command: ClientCommand): Promise<void> {
    if (this.#closed) {
      throw new Error("Tournament service is closed.");
    }
    switch (command.type) {
      case "event.load":
        await this.loadEvent(command.providerId, command.input, false);
        break;
      case "phase.select":
        await this.#selectPhaseGroup(command.phaseGroupId);
        break;
      case "set.select":
        await this.#selectSet(command.setId);
        break;
      case "live.take": {
        const event = this.getState().event;
        if (event === null || event.id !== command.eventId ||
            findSet(event, command.setId) === null) {
          throw new ProviderError("set_not_found", "The preview set is no longer available. Select it again.");
        }
        await this.#live.take(event, command.setId);
        await this.#saveOperator(this.getState().operator);
        break;
      }
      case "presentation.swap":
        await this.#updatePresentation(
          this.getState().operator.presentation.sideOrder === "normal"
            ? "swapped"
            : "normal",
        );
        break;
      case "presentation.clear":
        await this.#updatePresentation("normal");
        break;
      case "overlay.select":
        await this.#selectOverlayTemplate(command.templateId);
        break;
      case "refresh":
        this.#live.refresh();
        await this.loadEvent(
          this.getState().operator.providerId,
          this.getState().operator.eventInput,
          true,
        );
        break;
    }
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#pollGeneration += 1;
    this.#cancelPoll();
    this.#abortActiveRequest();
    this.#live.close();
  }

  public async loadEvent(
    providerId: ProviderId,
    input: string,
    preserveSelection: boolean,
  ): Promise<void> {
    if (this.#closed) {
      throw new Error("Tournament service is closed.");
    }
    const generation = ++this.#pollGeneration;
    this.#cancelPoll();
    const controller = this.#beginRequest();
    const previous = this.getState();
    const loadingOperator: OperatorState = {
      ...previous.operator,
      providerId,
      eventInput: input.trim(),
      selectedPhaseGroupId: preserveSelection
        ? previous.operator.selectedPhaseGroupId
        : null,
      selectedSetId: preserveSelection
        ? previous.operator.selectedSetId
        : null,
      presentation: previous.operator.presentation,
    };
    this.#commit({
      operator: loadingOperator,
      event: preserveSelection ? previous.event : null,
      connection: {
        ...(preserveSelection ? previous.connection : IDLE_CONNECTION),
        status: "loading",
        message: "Loading event metadata…",
        nextPollAt: null,
      },
    });

    try {
      const provider = this.providers.get(providerId);
      const metadata = await provider.loadEvent(input, {
        signal: controller.signal,
      });
      if (generation !== this.#pollGeneration) {
        throw new DOMException("The request was superseded.", "AbortError");
      }
      let event = this.#mergeCachedPhaseGroups(
        metadata,
        preserveSelection ? previous.event : null,
      );
      const selectedPhaseGroupId = this.#resolvePhaseGroupSelection(
        event,
        loadingOperator.selectedPhaseGroupId,
      );
      const loadingSelectedSetId = this.#resolveSetSelection(
        event,
        selectedPhaseGroupId,
        loadingOperator.selectedSetId,
      );
      let operator: OperatorState = {
        ...this.getState().operator,
        providerId,
        eventInput: event.slug,
        selectedPhaseGroupId,
        selectedSetId: loadingSelectedSetId,
      };
      this.#commit({
        operator,
        event,
        connection: {
          ...this.getState().connection,
          status: "loading",
          message: this.#phaseGroupLoadingMessage(event, selectedPhaseGroupId),
          nextPollAt: null,
        },
      });

      const selectedGroup = event.phaseGroups.find(
        (group) => group.id === selectedPhaseGroupId,
      );
      if (selectedGroup !== undefined) {
        event = await this.#loadPhaseGroup(
          provider,
          event,
          selectedGroup,
          generation,
          controller.signal,
        );
      }
      if (generation !== this.#pollGeneration) {
        throw new DOMException("The request was superseded.", "AbortError");
      }

      const selectedSetId = this.#resolveSetSelection(
        event,
        selectedPhaseGroupId,
        this.getState().operator.selectedSetId,
      );
      operator = {
        ...this.getState().operator,
        providerId,
        eventInput: event.slug,
        selectedPhaseGroupId,
        selectedSetId,
      };
      const now = new Date().toISOString();
      this.#commit({
        operator,
        event,
        connection: {
          status: "fresh",
          message: null,
          lastUpdatedAt: now,
          nextPollAt: selectedPhaseGroupId === null ? null : this.#bracketNextPollAt(),
          failureCount: 0,
        },
      });
      await this.#saveOperator(operator);
      if (generation === this.#pollGeneration && !this.#closed) {
        this.#scheduleBracketRefresh(this.bracketRefreshIntervalMs, generation);
      }
    } catch (error) {
      if (generation !== this.#pollGeneration) {
        throw error;
      }
      const message = this.#messageFromError(error);
      const current = this.getState();
      this.#commit({
        operator: current.operator,
        event: current.event,
        connection: {
          status: current.event === null ? "error" : "stale",
          message,
          lastUpdatedAt: current.connection.lastUpdatedAt,
          nextPollAt: canRetry(error)
            ? new Date(Date.now() + retryDelay(this.pollIntervalMs, current.connection.failureCount + 1)).toISOString()
            : null,
          failureCount: current.connection.failureCount + 1,
        },
      });
      if (canRetry(error)) {
        this.#scheduleBracketRefresh(
          retryDelay(this.pollIntervalMs, current.connection.failureCount + 1),
          generation,
          () => this.loadEvent(providerId, input, true),
        );
      }
      throw error;
    } finally {
      this.#clearActiveRequest(controller);
    }
  }

  async #selectPhaseGroup(phaseGroupId: string, force = false): Promise<void> {
    const state = this.getState();
    const event = state.event;
    const group = event?.phaseGroups.find(
      (candidate) => candidate.id === phaseGroupId,
    );
    if (event === null || group === undefined) {
      throw new ProviderError(
        "phase_group_not_found",
        `Phase group "${phaseGroupId}" is not available.`,
      );
    }
    const generation = ++this.#pollGeneration;
    this.#cancelPoll();
    const controller = this.#beginRequest();
    const age = group.setsFetchedAt === null
      ? Number.POSITIVE_INFINITY
      : Date.now() - Date.parse(group.setsFetchedAt);
    const useCache = !force && group.setsLoaded && age < this.bracketRefreshIntervalMs;
    const operator: OperatorState = {
      ...state.operator,
      selectedPhaseGroupId: group.id,
      selectedSetId: group.setsLoaded
        ? this.#resolveSetSelection(event, group.id,
          state.operator.selectedPhaseGroupId === group.id ? state.operator.selectedSetId : null)
        : null,
    };
    this.#commit({
      operator,
      connection: useCache
        ? {
            ...state.connection,
            status: "fresh",
            message: null,
            lastUpdatedAt: group.setsFetchedAt,
            nextPollAt: new Date(Date.now() + this.bracketRefreshIntervalMs - age).toISOString(),
            failureCount: 0,
          }
        : {
            ...state.connection,
            status: "loading",
            lastUpdatedAt: group.setsFetchedAt,
            message: this.#phaseGroupLoadingMessage(event, group.id),
            nextPollAt: null,
          },
    });
    try {
      await this.#saveOperator(operator);
      if (useCache) {
        this.#scheduleBracketRefresh(this.bracketRefreshIntervalMs - age, generation);
        return;
      }
      const provider = this.providers.get(state.operator.providerId);
      const loadedEvent = await this.#loadPhaseGroup(
        provider,
        event,
        group,
        generation,
        controller.signal,
      );
      if (generation !== this.#pollGeneration) {
        throw new DOMException("The request was superseded.", "AbortError");
      }
      const selectedSetId = this.#resolveSetSelection(
        loadedEvent,
        group.id,
        this.getState().operator.selectedSetId,
      );
      const loadedOperator = {
        ...this.getState().operator,
        selectedPhaseGroupId: group.id,
        selectedSetId,
      };
      this.#commit({
        operator: loadedOperator,
        event: loadedEvent,
        connection: {
          status: "fresh",
          message: null,
          lastUpdatedAt: new Date().toISOString(),
          nextPollAt: this.#bracketNextPollAt(),
          failureCount: 0,
        },
      });
      await this.#saveOperator(loadedOperator);
      if (generation === this.#pollGeneration && !this.#closed) {
        this.#scheduleBracketRefresh(this.bracketRefreshIntervalMs, generation);
      }
    } catch (error) {
      if (generation !== this.#pollGeneration) {
        throw error;
      }
      const current = this.getState();
      this.#commit({
        connection: {
          ...current.connection,
          status: "stale",
          message: this.#messageFromError(error),
          nextPollAt: canRetry(error)
            ? new Date(Date.now() + retryDelay(this.pollIntervalMs, current.connection.failureCount + 1)).toISOString()
            : null,
          failureCount: current.connection.failureCount + 1,
        },
      });
      if (canRetry(error)) {
        this.#scheduleBracketRefresh(
          retryDelay(this.pollIntervalMs, current.connection.failureCount + 1),
          generation,
        );
      }
      throw error;
    } finally {
      this.#clearActiveRequest(controller);
    }
  }

  async #selectSet(setId: string): Promise<void> {
    const state = this.getState();
    const set = findSet(state.event, setId);
    if (set === null) {
      throw new ProviderError(
        "set_not_found",
        `Set "${setId}" is not available.`,
      );
    }
    if (set.phaseGroupId !== state.operator.selectedPhaseGroupId) {
      await this.#selectPhaseGroup(set.phaseGroupId);
    }
    const operator: OperatorState = {
      ...this.getState().operator,
      selectedPhaseGroupId: set.phaseGroupId,
      selectedSetId: set.id,
    };
    this.#commit({ operator });
    await this.#saveOperator(operator);
  }

  async #updatePresentation(
    sideOrder: OperatorState["presentation"]["sideOrder"],
  ): Promise<void> {
    const state = this.getState();
    const operator: OperatorState = {
      ...state.operator,
      presentation: {
        ...state.operator.presentation,
        sideOrder,
      },
    };
    this.#commit({ operator });
    await this.#saveOperator(operator);
  }

  async #selectOverlayTemplate(
    overlayTemplateId: OperatorState["presentation"]["overlayTemplateId"],
  ): Promise<void> {
    const state = this.getState();
    const operator: OperatorState = {
      ...state.operator,
      presentation: {
        ...state.operator.presentation,
        overlayTemplateId,
      },
    };
    this.#commit({ operator });
    await this.#saveOperator(operator);
  }

  #scheduleBracketRefresh(
    delayMs: number,
    generation: number,
    retry?: () => Promise<void>,
  ): void {
    if (this.#closed || generation !== this.#pollGeneration) {
      return;
    }
    this.#cancelPoll();
    const groupId = this.getState().operator.selectedPhaseGroupId;
    if (retry === undefined && groupId === null) {
      return;
    }
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      const refresh = retry ?? (() => groupId === null
        ? Promise.reject(new Error("No phase group is selected."))
        : this.#selectPhaseGroup(groupId, true));
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
      onProgress: (progress) => {
        this.#publishPhaseGroupProgress(event.id, group, generation, progress);
      },
    });
    const current = this.getState().event;
    const base = current?.id === event.id ? current : event;
    return this.#replacePhaseGroupSets(base, group.id, sets, true);
  }

  #publishPhaseGroupProgress(
    eventId: string,
    group: NormalizedPhaseGroup,
    generation: number,
    progress: PhaseGroupLoadProgress,
  ): void {
    if (generation !== this.#pollGeneration) {
      return;
    }
    const state = this.getState();
    if (state.event?.id !== eventId) {
      return;
    }

    this.#commit({
      event: group.setsLoaded
        ? state.event
        : this.#replacePhaseGroupSets(
            state.event,
            group.id,
            progress.sets,
            false,
          ),
      connection: {
        ...state.connection,
        status: "loading",
        message: `Loading ${group.phaseName}: page ${String(progress.loadedPages)} of ${String(progress.totalPages)} (${String(progress.sets.length)} sets)…`,
        nextPollAt: null,
      },
    });
  }

  #commit(
    patch: Partial<
      Pick<ServerState, "providers" | "operator" | "connection" | "liveConnection" | "event">
    >,
  ): void {
    const current = this.getState();
    const revision = current.revision + 1;
    const operator = patch.operator ?? current.operator;
    const connection = patch.connection ?? current.connection;
    const event = patch.event === undefined ? current.event : patch.event;
    this.#hub.publish({
      ...current,
      ...patch,
      revision,
      operator,
      connection,
      event,
      overlay: deriveOverlayView(
        revision,
        this.#liveEvent,
        this.#liveSet,
        operator.presentation,
        (patch.liveConnection ?? current.liveConnection).status,
      ),
    });
  }

  #cancelPoll(): void {
    if (this.#pollTimer !== null) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #beginRequest(): AbortController {
    this.#abortActiveRequest();
    const controller = new AbortController();
    this.#activeRequestController = controller;
    return controller;
  }

  #abortActiveRequest(): void {
    this.#activeRequestController?.abort(
      new DOMException("The request was superseded.", "AbortError"),
    );
    this.#activeRequestController = null;
  }

  #clearActiveRequest(controller: AbortController): void {
    if (this.#activeRequestController === controller) {
      this.#activeRequestController = null;
    }
  }

  #saveOperator(operator: OperatorState): Promise<void> {
    const save = this.#saveQueue
      .then(() => this.store.save(operator))
      .catch((error: unknown) => {
        throw new ProviderError(
          "persistence_failed",
          "The scene changed, but its settings could not be saved locally. Check the state file location and permissions.",
          { cause: error },
        );
      });
    this.#saveQueue = save.catch(() => undefined);
    return save;
  }

  #bracketNextPollAt(): string {
    return new Date(Date.now() + this.bracketRefreshIntervalMs).toISOString();
  }

  #phaseGroupLoadingMessage(
    event: NormalizedEvent,
    phaseGroupId: string | null,
  ): string {
    const group = event.phaseGroups.find(
      (candidate) => candidate.id === phaseGroupId,
    );
    return group === undefined
      ? "Event metadata loaded."
      : `Loading ${group.phaseName} bracket…`;
  }

  #mergeCachedPhaseGroups(
    event: NormalizedEvent,
    previous: NormalizedEvent | null,
  ): NormalizedEvent {
    if (previous?.id !== event.id || previous.providerId !== event.providerId) {
      return event;
    }
    return {
      ...event,
      phaseGroups: event.phaseGroups.map((group) => {
        const cached = previous.phaseGroups.find(
          (candidate) => candidate.id === group.id && candidate.setsLoaded,
        );
        return cached === undefined ? group : {
          ...group,
          setsLoaded: cached.setsLoaded,
          setsFetchedAt: cached.setsFetchedAt,
          sets: cached.sets,
        };
      }),
    };
  }

  #resolvePhaseGroupSelection(
    event: NormalizedEvent,
    requested: string | null,
  ): string | null {
    if (
      requested !== null &&
      event.phaseGroups.some((group) => group.id === requested)
    ) {
      return requested;
    }
    return event.phaseGroups[0]?.id ?? null;
  }

  #resolveSetSelection(
    event: NormalizedEvent,
    phaseGroupId: string | null,
    requested: string | null,
  ): string | null {
    const group = event.phaseGroups.find(
      (candidate) => candidate.id === phaseGroupId,
    );
    if (group === undefined) {
      return null;
    }
    if (!group.setsLoaded && requested !== null) {
      return requested;
    }
    if (
      requested !== null &&
      group.sets.some((set) => set.id === requested)
    ) {
      return requested;
    }
    return (
      group.sets.find((set) => set.state === "active")?.id ??
      group.sets[0]?.id ??
      null
    );
  }

  #replaceSet(event: NormalizedEvent, updatedSet: NormalizedSet): NormalizedEvent {
    return {
      ...event,
      fetchedAt: new Date().toISOString(),
      phaseGroups: event.phaseGroups.map((group) =>
        group.id === updatedSet.phaseGroupId
          ? {
              ...group,
              sets: group.sets.map((set) =>
                set.id === updatedSet.id ? updatedSet : set,
              ),
            }
          : group,
      ),
    };
  }

  #replacePhaseGroupSets(
    event: NormalizedEvent,
    phaseGroupId: string,
    sets: readonly NormalizedSet[],
    setsLoaded: boolean,
  ): NormalizedEvent {
    const mergedSets = this.#mergeCachedSetProfiles(
      event,
      phaseGroupId,
      sets,
    );
    return {
      ...event,
      fetchedAt: new Date().toISOString(),
      phaseGroups: event.phaseGroups.map((group) =>
        group.id === phaseGroupId
          ? {
              ...group,
              setsLoaded,
              setsFetchedAt: setsLoaded ? new Date().toISOString() : group.setsFetchedAt,
              sets: mergedSets,
            }
          : group,
      ),
    };
  }

  #mergeCachedSetProfiles(
    event: NormalizedEvent,
    phaseGroupId: string,
    sets: readonly NormalizedSet[],
  ): readonly NormalizedSet[] {
    const cachedGroup = event.phaseGroups.find(
      (group) => group.id === phaseGroupId,
    );
    if (cachedGroup === undefined) {
      return sets;
    }

    return sets.map((set) => {
      const cachedSet = cachedGroup.sets.find(
        (candidate) => candidate.id === set.id,
      );
      if (cachedSet === undefined) {
        return set;
      }

      const mergeSlot = (index: 0 | 1): NormalizedSet["entrants"][number] => {
        const slot = set.entrants[index];
        const cachedSlot = cachedSet.entrants[index];
        if (
          slot === null ||
          cachedSlot === null ||
          slot.entrant.id !== cachedSlot.entrant.id
        ) {
          return slot;
        }
        return {
          ...slot,
          entrant: {
            ...slot.entrant,
            prefix: slot.entrant.prefix ?? cachedSlot.entrant.prefix,
            pronouns: slot.entrant.pronouns ?? cachedSlot.entrant.pronouns,
            social: slot.entrant.social ?? cachedSlot.entrant.social,
            location: slot.entrant.location ?? cachedSlot.entrant.location,
          },
        };
      };

      return {
        ...set,
        entrants: [mergeSlot(0), mergeSlot(1)],
      };
    });
  }

  #messageFromError(error: unknown): string {
    if (error instanceof ProviderError) {
      return error.message;
    }
    if (error instanceof Error) {
      return `Provider request failed: ${error.message}`;
    }
    return "Provider request failed with an unknown error.";
  }
}
