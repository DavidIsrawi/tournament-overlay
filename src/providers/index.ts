import type {
  NormalizedEvent,
  NormalizedSet,
  ProviderDescriptor,
  ProviderId,
} from "../shared/contracts.ts";

export interface TournamentDataProvider {
  readonly descriptor: ProviderDescriptor;
  loadEvent(input: string): Promise<NormalizedEvent>;
  loadSet(setId: string, event: NormalizedEvent): Promise<NormalizedSet>;
}

export class ProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export class ProviderRegistry {
  readonly #providers = new Map<ProviderId, TournamentDataProvider>();

  public constructor(providers: readonly TournamentDataProvider[]) {
    for (const provider of providers) {
      if (this.#providers.has(provider.descriptor.id)) {
        throw new Error(`Duplicate provider id: ${provider.descriptor.id}`);
      }
      this.#providers.set(provider.descriptor.id, provider);
    }
  }

  public get(id: ProviderId): TournamentDataProvider {
    const provider = this.#providers.get(id);
    if (provider === undefined) {
      throw new ProviderError(
        "unknown_provider",
        `Provider "${id}" is not registered.`,
      );
    }
    return provider;
  }

  public has(id: ProviderId): boolean {
    return this.#providers.has(id);
  }

  public list(): readonly ProviderDescriptor[] {
    return [...this.#providers.values()].map(
      (provider) => provider.descriptor,
    );
  }
}

export {
  normalizeStartGgEvent,
  parseStartGgEventInput,
  StartGgProvider,
} from "./startgg.ts";
