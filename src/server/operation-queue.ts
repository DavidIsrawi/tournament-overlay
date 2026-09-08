export class OperationQueue {
  #pending: Promise<void> = Promise.resolve();

  public run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation);
    // Keep later operations usable without changing the caller's failure.
    this.#pending = result.then(() => {}, () => {});
    return result;
  }
}
