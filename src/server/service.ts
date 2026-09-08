import {
  PROTOCOL_VERSION,
  deriveOverlayView,
  findSet,
  type ClientCommand,
  type NormalizedEvent,
  type NormalizedSet,
  type OperatorState,
  type PresentationState,
  type ProviderId,
  type ServerState,
} from "../shared/contracts.ts";
import {
  ProviderError,
  type ProviderRegistry,
  type TournamentDataProvider,
} from "../providers/index.ts";
import type { AtomicOperatorStateStore } from "./persistence.ts";
import { StateHub, type StateListener } from "./state-hub.ts";
import { LiveScene } from "./live-scene.ts";
import { IDLE_CONNECTION, requestMessage } from "./provider-recovery.ts";
import { BracketController, BRACKET_REFRESH_INTERVAL_MS } from "./bracket-controller.ts";
import { replaceBracketSet } from "./bracket-data.ts";
import { OperationQueue } from "./operation-queue.ts";
import { APP_VERSION } from "../shared/app-info.ts";
import { DEFAULT_OVERLAY_METADATA_FIELDS } from "../shared/overlay-metadata.ts";

export { BRACKET_REFRESH_INTERVAL_MS } from "./bracket-controller.ts";

const DEFAULT_OPERATOR_STATE: OperatorState = {
  providerId: "startgg",
  eventInput: "",
  selectedPhaseGroupId: null,
  selectedSetId: null,
  liveSelection: null,
  previousLiveSelection: null,
  presentation: {
    sideOrder: "normal",
    overlayTemplateId: "octagon",
    metadataFields: DEFAULT_OVERLAY_METADATA_FIELDS,
    overlayVisible: true,
  },
};

export class TournamentService {
  readonly #hub: StateHub;
  readonly #live: LiveScene;
  readonly #bracket: BracketController;
  #liveEvent: NormalizedEvent | null = null;
  #liveSet: NormalizedSet | null = null;
  readonly #saveQueue = new OperationQueue();
  #operatorReady: Promise<void> = Promise.resolve();
  #restoreError: Error | null = null;
  #closed = false;

  public constructor(
    private readonly providers: ProviderRegistry,
    private readonly store: AtomicOperatorStateStore,
    pollIntervalMs: number,
    bracketRefreshIntervalMs = BRACKET_REFRESH_INTERVAL_MS,
  ) {
    this.#hub = new StateHub({
      appVersion: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      revision: 0,
      startedAt: new Date().toISOString(),
      providers: providers.list(),
      operator: DEFAULT_OPERATOR_STATE,
      connection: IDLE_CONNECTION,
      liveConnection: IDLE_CONNECTION,
      event: null,
      overlay: deriveOverlayView(
        0,
        null,
        null,
        DEFAULT_OPERATOR_STATE.presentation,
        IDLE_CONNECTION.status,
      ),
    });
    this.#bracket = new BracketController(providers, {
      get: () => {
        const { operator, event, connection } = this.getState();
        const { providerId, eventInput, selectedPhaseGroupId, selectedSetId } = operator;
        return {
          selection: { providerId, eventInput, selectedPhaseGroupId, selectedSetId },
          event,
          connection,
        };
      },
      publish: ({ selection, ...patch }) => this.#commit({
        ...patch,
        ...(selection === undefined ? {} : { operator: { ...this.getState().operator, ...selection } }),
      }),
      save: () => this.#saveOperator(this.getState().operator),
    }, pollIntervalMs, bracketRefreshIntervalMs);
    this.#live = new LiveScene(providers, pollIntervalMs, (scene) => {
      const previousEvent = this.#liveEvent;
      this.#liveEvent = scene.event;
      this.#liveSet = scene.set;
      const current = this.getState();
      const previous = current.operator.liveSelection;
      const changed = scene.taken && scene.selection !== null &&
        (previous === null ||
          previous.providerId !== scene.selection.providerId ||
          (previousEvent === null
            ? previous.eventInput !== scene.selection.eventInput
            : previousEvent.id !== scene.event?.id) ||
          previous.setId !== scene.selection.setId);
      const event = scene.set !== null && current.event !== null &&
        current.event.id === scene.event?.id &&
        current.event.providerId === scene.event?.providerId
        ? replaceBracketSet(current.event, scene.set)
        : current.event;
      this.#commit({
        event,
        operator: {
          ...current.operator,
          liveSelection: scene.selection,
          previousLiveSelection: changed ? previous : current.operator.previousLiveSelection,
          presentation: scene.taken
            ? { ...current.operator.presentation, overlayVisible: true }
            : current.operator.presentation,
        },
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
    this.#bracket.invalidate();
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
        message: current.event === null
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
      : {
          ...persistedOperator,
          providerId: DEFAULT_OPERATOR_STATE.providerId,
          eventInput: "",
          selectedPhaseGroupId: null,
          selectedSetId: null,
        };
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
        await this.#bracket.selectPhaseGroup(command.phaseGroupId);
        break;
      case "set.select":
        await this.#bracket.selectSet(command.setId);
        break;
      case "live.take": {
        const event = this.getState().event;
        if (event === null || event.id !== command.eventId || findSet(event, command.setId) === null) {
          throw new ProviderError("set_not_found", "The preview set is no longer available. Select it again.");
        }
        await this.#live.take(event, command.setId);
        await this.#saveOperator(this.getState().operator);
        break;
      }
      case "live.restore": {
        const selection = this.getState().operator.previousLiveSelection;
        if (selection === null) {
          throw new ProviderError("set_not_found", "There is no previous live set to restore.");
        }
        await this.#live.takeSelection(selection);
        await this.#saveOperator(this.getState().operator);
        break;
      }
      case "overlay.visibility":
        if (command.visible) {
          if (this.#liveSet === null || this.getState().operator.liveSelection === null) {
            throw new ProviderError("set_not_found", "Take a valid set live before showing the overlay.");
          }
        } else {
          this.#live.cancelTake();
        }
        await this.#updatePresentation({ overlayVisible: command.visible });
        break;
      case "presentation.metadata":
        await this.#updatePresentation({ metadataFields: command.fields });
        break;
      case "presentation.swap":
        await this.#updatePresentation({
          sideOrder: this.getState().operator.presentation.sideOrder === "normal" ? "swapped" : "normal",
        });
        break;
      case "presentation.clear":
        await this.#updatePresentation({ sideOrder: "normal" });
        break;
      case "overlay.select":
        await this.#updatePresentation({ overlayTemplateId: command.templateId });
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
    this.#bracket.close();
    this.#live.close();
  }

  public loadEvent(providerId: ProviderId, input: string, preserveSelection: boolean): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("Tournament service is closed."));
    }
    return this.#bracket.loadEvent(providerId, input, preserveSelection);
  }

  async #updatePresentation(patch: Partial<PresentationState>): Promise<void> {
    const state = this.getState();
    const operator: OperatorState = {
      ...state.operator,
      presentation: { ...state.operator.presentation, ...patch },
    };
    this.#commit({ operator });
    await this.#saveOperator(operator);
  }

  #commit(
    patch: Partial<Pick<ServerState, "providers" | "operator" | "connection" | "liveConnection" | "event">>,
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

  #saveOperator(operator: OperatorState): Promise<void> {
    return this.#saveQueue
      .run(() => this.store.save(operator))
      .catch((error: unknown) => {
        throw new ProviderError(
          "persistence_failed",
          "The scene changed, but its settings could not be saved locally. Check the state file location and permissions.",
          { cause: error },
        );
      });
  }
}
