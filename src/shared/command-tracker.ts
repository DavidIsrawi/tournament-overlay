import type { ClientCommand, ConnectionState } from "./contracts.ts";

export interface PendingCommand {
  readonly commandId: string;
  readonly type: ClientCommand["type"];
}

export class CommandTracker {
  readonly #pending = new Map<string, ClientCommand["type"]>();
  #error: { readonly message: string; readonly type: ClientCommand["type"] | null } | null = null;

  public get pending(): readonly PendingCommand[] {
    return [...this.#pending].map(([commandId, type]) => ({ commandId, type }));
  }

  public get error(): string | null {
    return this.#error?.message ?? null;
  }

  public begin(commandId: string, command: ClientCommand): boolean {
    const replaceable = command.type === "event.load" || command.type === "phase.select" || command.type === "set.select";
    if (!replaceable && [...this.#pending.values()].includes(command.type)) {
      return false;
    }
    this.#pending.set(commandId, command.type);
    if (this.#error?.type === command.type) {
      this.#error = null;
    }
    return true;
  }

  public acknowledge(commandId: string): void {
    const type = this.#pending.get(commandId);
    if (type !== undefined && this.#error?.type === type) {
      this.#error = null;
    }
    this.#pending.delete(commandId);
  }

  public fail(commandId: string | null, message: string): void {
    if (commandId === null) {
      this.#error = { message, type: null };
      return;
    }
    const type = this.#pending.get(commandId);
    if (type !== undefined) {
      this.#pending.delete(commandId);
      this.#error = { message, type };
    }
  }

  public disconnect(): void {
    if (this.#pending.size > 0) {
      this.#error = {
        message: "Connection lost before confirmation. Check the synchronized scene before trying again.",
        type: null,
      };
    }
    this.#pending.clear();
  }

  public reconcileBracket(status: ConnectionState["status"]): void {
    if (status === "fresh" && this.#error !== null &&
        (this.#error.type === "event.load" || this.#error.type === "phase.select" || this.#error.type === "refresh")) {
      this.#error = null;
    }
  }

  public dismissError(): void {
    this.#error = null;
  }
}
