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

const DEFAULT_OPERATOR_STATE: OperatorState = {
  providerId: "startgg",
  eventInput: "",
  selectedPhaseGroupId: null,
  selectedSetId: null,
  presentation: {
    sideOrder: "normal",
    overlayTemplateId: "octagon",
  },
};

export class TournamentService {
  readonly #hub: StateHub;
  #saveQueue: Promise<void> = Promise.resolve();
  #operatorReady: Promise<void> = Promise.resolve();
  #pollTimer: NodeJS.Timeout | null = null;
  #pollGeneration = 0;
  #activeRequestController: AbortController | null = null;
  #closed = false;

  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly store: AtomicOperatorStateStore,
    private readonly pollIntervalMs: number,
  ) {
    const connection: ConnectionState = {
      status: "idle",
      message: null,
      lastUpdatedAt: null,
      nextPollAt: null,
      failureCount: 0,
    };
    this.#hub = new StateHub({
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      startedAt: new Date().toISOString(),
      providers: providers.list(),
      operator: DEFAULT_OPERATOR_STATE,
      connection,
      event: null,
      overlay: deriveOverlayView(
        0,
        null,
        null,
        DEFAULT_OPERATOR_STATE.presentation,
        connection.status,
      ),
    });
  }

  public getState(): ServerState {
    return this.#hub.get();
  }

  public subscribe(listener: StateListener): () => void {
    return this.#hub.subscribe(listener);
  }

  public initialize(): Promise<void> {
    const restore = this.#restoreOperator();
    this.#operatorReady = restore.then(
      () => undefined,
      () => undefined,
    );
    return restore.then(async (operator) => {
      if (
        operator !== null &&
        operator.eventInput.trim().length > 0 &&
        !this.#closed
      ) {
        await this.loadEvent(operator.providerId, operator.eventInput, true);
      }
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
    return this.#operatorReady.then(() => this.#dispatchCommand(command));
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
  }

  public async loadEvent(
    providerId: ProviderId,
    input: string,
    preserveSelection: boolean,
  ): Promise<void> {
    if (this.#closed) {
      return;
    }
    const generation = ++this.#pollGeneration;
    this.#cancelPoll();
    const controller = this.#beginRequest();
    const previous = this.getState();
    const loadingOperator: OperatorState = {
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
        ...previous.connection,
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
        return;
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
        return;
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
          nextPollAt: selectedSetId === null ? null : this.#nextPollAt(0),
          failureCount: 0,
        },
      });
      await this.#saveOperator(operator);
      if (generation === this.#pollGeneration && !this.#closed) {
        this.#schedulePoll(0, generation);
      }
    } catch (error) {
      if (generation !== this.#pollGeneration) {
        return;
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
          nextPollAt: null,
          failureCount: current.connection.failureCount + 1,
        },
      });
      await this.#saveOperator(current.operator);
    } finally {
      this.#clearActiveRequest(controller);
    }
  }

  async #selectPhaseGroup(phaseGroupId: string): Promise<void> {
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
    const operator: OperatorState = {
      ...state.operator,
      selectedPhaseGroupId: group.id,
      selectedSetId: group.setsLoaded
        ? this.#resolveSetSelection(event, group.id, null)
        : null,
    };
    this.#commit({
      operator,
      connection: group.setsLoaded
        ? {
            ...state.connection,
            status: "fresh",
            message: null,
            nextPollAt:
              operator.selectedSetId === null ? null : this.#nextPollAt(0),
          }
        : {
            ...state.connection,
            status: "loading",
            message: this.#phaseGroupLoadingMessage(event, group.id),
            nextPollAt: null,
          },
    });
    await this.#saveOperator(operator);

    if (group.setsLoaded) {
      this.#clearActiveRequest(controller);
      this.#schedulePoll(0, generation);
      return;
    }

    try {
      const provider = this.providers.get(state.operator.providerId);
      const loadedEvent = await this.#loadPhaseGroup(
        provider,
        event,
        group,
        generation,
        controller.signal,
      );
      if (generation !== this.#pollGeneration) {
        return;
      }
      const selectedSetId = this.#resolveSetSelection(
        loadedEvent,
        group.id,
        null,
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
          nextPollAt: selectedSetId === null ? null : this.#nextPollAt(0),
          failureCount: 0,
        },
      });
      await this.#saveOperator(loadedOperator);
      if (generation === this.#pollGeneration && !this.#closed) {
        this.#schedulePoll(0, generation);
      }
    } catch (error) {
      if (generation !== this.#pollGeneration) {
        return;
      }
      const current = this.getState();
      this.#commit({
        connection: {
          ...current.connection,
          status: "stale",
          message: this.#messageFromError(error),
          nextPollAt: null,
          failureCount: current.connection.failureCount + 1,
        },
      });
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
    const group = state.event?.phaseGroups.find(
      (candidate) => candidate.id === set.phaseGroupId,
    );
    if (
      group?.setsLoaded === false &&
      set.phaseGroupId === state.operator.selectedPhaseGroupId &&
      state.connection.status === "loading"
    ) {
      const operator: OperatorState = {
        ...state.operator,
        selectedPhaseGroupId: set.phaseGroupId,
        selectedSetId: set.id,
      };
      this.#commit({ operator });
      await this.#saveOperator(operator);
      return;
    }

    const generation = ++this.#pollGeneration;
    this.#cancelPoll();
    this.#abortActiveRequest();
    const operator: OperatorState = {
      ...state.operator,
      selectedPhaseGroupId: set.phaseGroupId,
      selectedSetId: set.id,
    };
    this.#commit({
      operator,
      connection: {
        ...state.connection,
        nextPollAt: this.#nextPollAt(0),
      },
    });
    await this.#saveOperator(operator);
    if (generation === this.#pollGeneration && !this.#closed) {
      this.#schedulePoll(0, generation);
    }
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

  #schedulePoll(delayMs: number, generation: number): void {
    if (this.#closed || generation !== this.#pollGeneration) {
      return;
    }
    this.#cancelPoll();
    if (this.getState().operator.selectedSetId === null) {
      return;
    }
    this.#pollTimer = setTimeout(() => {
      void this.#pollSelectedSet(generation);
    }, delayMs);
  }

  async #pollSelectedSet(generation: number): Promise<void> {
    if (generation !== this.#pollGeneration) {
      return;
    }
    const state = this.getState();
    const event = state.event;
    const selectedSetId = state.operator.selectedSetId;
    if (event === null || selectedSetId === null) {
      return;
    }

    const controller = this.#beginRequest();
    try {
      const provider = this.providers.get(state.operator.providerId);
      const set = await provider.loadSet(selectedSetId, event, {
        signal: controller.signal,
      });
      if (generation !== this.#pollGeneration) {
        return;
      }
      const updatedEvent = this.#replaceSet(event, set);
      this.#commit({
        event: updatedEvent,
        connection: {
          status: "fresh",
          message: null,
          lastUpdatedAt: new Date().toISOString(),
          nextPollAt: this.#nextPollAt(1),
          failureCount: 0,
        },
      });
      this.#schedulePoll(this.pollIntervalMs, generation);
    } catch (error) {
      if (generation !== this.#pollGeneration) {
        return;
      }
      const failureCount = state.connection.failureCount + 1;
      const delay = Math.min(
        this.pollIntervalMs * 2 ** failureCount,
        120_000,
      );
      this.#commit({
        connection: {
          ...state.connection,
          status: "stale",
          message: this.#messageFromError(error),
          nextPollAt: this.#nextPollAt(delay / this.pollIntervalMs),
          failureCount,
        },
      });
      this.#schedulePoll(delay, generation);
    } finally {
      this.#clearActiveRequest(controller);
    }
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
      Pick<ServerState, "operator" | "connection" | "event">
    >,
  ): void {
    const current = this.getState();
    const revision = current.revision + 1;
    const operator = patch.operator ?? current.operator;
    const connection = patch.connection ?? current.connection;
    const event = patch.event === undefined ? current.event : patch.event;
    const selectedSet = findSet(event, operator.selectedSetId);
    this.#hub.publish({
      ...current,
      ...patch,
      revision,
      operator,
      connection,
      event,
      overlay: deriveOverlayView(
        revision,
        event,
        selectedSet,
        operator.presentation,
        connection.status,
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
    const save = this.#saveQueue.then(() => this.store.save(operator));
    this.#saveQueue = save.catch(() => undefined);
    return save;
  }

  #nextPollAt(multiplier: number): string {
    return new Date(
      Date.now() + this.pollIntervalMs * multiplier,
    ).toISOString();
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
    if (previous?.id !== event.id) {
      return event;
    }
    return {
      ...event,
      phaseGroups: event.phaseGroups.map((group) => {
        const cached = previous.phaseGroups.find(
          (candidate) => candidate.id === group.id && candidate.setsLoaded,
        );
        return cached === undefined ? group : cached;
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
