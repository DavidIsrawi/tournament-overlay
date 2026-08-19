import type { ServerState } from "@tournament-overlay/contracts";

export type StateListener = (state: ServerState) => void;

export class StateHub {
  readonly #listeners = new Set<StateListener>();

  public constructor(private state: ServerState) {}

  public get(): ServerState {
    return this.state;
  }

  public publish(state: ServerState): void {
    this.state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  public subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
