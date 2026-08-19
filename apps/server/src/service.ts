import {
  PROTOCOL_VERSION,
  deriveOverlayView,
  findSet,
  type ClientCommand,
  type ConnectionState,
  type NormalizedEvent,
  type NormalizedSet,
  type OperatorState,
  type ProviderId,
  type ServerState,
} from "@tournament-overlay/contracts";
import {
  ProviderError,
  type ProviderRegistry,
} from "@tournament-overlay/providers";
import type { AtomicOperatorStateStore } from "./persistence.ts";
import { StateHub, type StateListener } from "./state-hub.ts";

const DEFAULT_OPERATOR_STATE: OperatorState = {
  providerId: "demo",
  eventInput: "demo/octagon-open",
  selectedPhaseGroupId: "demo-top-8",
  selectedSetId: "demo-set-5",
  presentation: { sideOrder: "normal" },
};

export class TournamentService {
  readonly #hub: StateHub;
  #pollTimer: NodeJS.Timeout | null = null;
  #pollGeneration = 0;

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

  public async initialize(): Promise<void> {
    const operator = await this.store.load(DEFAULT_OPERATOR_STATE);
    this.#commit({ operator });
    await this.loadEvent(operator.providerId, operator.eventInput, true);
  }

  public async dispatch(command: ClientCommand): Promise<void> {
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
    this.#cancelPoll();
  }

  public async loadEvent(
    providerId: ProviderId,
    input: string,
    preserveSelection: boolean,
  ): Promise<void> {
    const generation = ++this.#pollGeneration;
    this.#cancelPoll();
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
      connection: {
        ...previous.connection,
        status: "loading",
        message: null,
        nextPollAt: null,
      },
    });

    try {
      const provider = this.providers.get(providerId);
      const event = await provider.loadEvent(input);
      if (generation !== this.#pollGeneration) {
        return;
      }
      const selectedPhaseGroupId = this.#resolvePhaseGroupSelection(
        event,
        loadingOperator.selectedPhaseGroupId,
      );
      const selectedSetId = this.#resolveSetSelection(
        event,
        selectedPhaseGroupId,
        loadingOperator.selectedSetId,
      );
      const operator: OperatorState = {
        ...loadingOperator,
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
          nextPollAt: selectedSetId === null ? null : this.#nextPollAt(1),
          failureCount: 0,
        },
      });
      await this.store.save(operator);
      this.#schedulePoll(this.pollIntervalMs, generation);
    } catch (error) {
      if (generation !== this.#pollGeneration) {
        return;
      }
      const message = this.#messageFromError(error);
      this.#commit({
        operator: loadingOperator,
        event: preserveSelection ? previous.event : null,
        connection: {
          status: previous.event === null ? "error" : "stale",
          message,
          lastUpdatedAt: previous.connection.lastUpdatedAt,
          nextPollAt: null,
          failureCount: previous.connection.failureCount + 1,
        },
      });
      await this.store.save(loadingOperator);
    }
  }

  async #selectPhaseGroup(phaseGroupId: string): Promise<void> {
    const state = this.getState();
    const group = state.event?.phaseGroups.find(
      (candidate) => candidate.id === phaseGroupId,
    );
    if (group === undefined) {
      throw new ProviderError(
        "phase_group_not_found",
        `Phase group "${phaseGroupId}" is not available.`,
      );
    }
    const operator: OperatorState = {
      ...state.operator,
      selectedPhaseGroupId: group.id,
      selectedSetId: group.sets[0]?.id ?? null,
    };
    this.#commit({ operator });
    await this.store.save(operator);
    this.#schedulePoll(0, ++this.#pollGeneration);
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
    const operator: OperatorState = {
      ...state.operator,
      selectedPhaseGroupId: set.phaseGroupId,
      selectedSetId: set.id,
    };
    this.#commit({ operator });
    await this.store.save(operator);
    this.#schedulePoll(0, ++this.#pollGeneration);
  }

  async #updatePresentation(
    sideOrder: OperatorState["presentation"]["sideOrder"],
  ): Promise<void> {
    const state = this.getState();
    const operator: OperatorState = {
      ...state.operator,
      presentation: { sideOrder },
    };
    this.#commit({ operator });
    await this.store.save(operator);
  }

  #schedulePoll(delayMs: number, generation: number): void {
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

    try {
      const provider = this.providers.get(state.operator.providerId);
      const set = await provider.loadSet(selectedSetId, event);
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
    }
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

  #nextPollAt(multiplier: number): string {
    return new Date(
      Date.now() + this.pollIntervalMs * multiplier,
    ).toISOString();
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
