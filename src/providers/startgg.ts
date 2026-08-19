import type {
  EntrantProfile,
  NormalizedEvent,
  NormalizedSet,
  ProviderDescriptor,
} from "../shared/contracts.ts";
import { GraphQLClient, gql } from "graphql-request";
import { z } from "zod";
import { ProviderError, type TournamentDataProvider } from "./index.ts";

const STARTGG_ENDPOINT = "https://api.start.gg/gql/alpha";

const idSchema = z.union([z.string(), z.number()]).transform(String);

const entrantSchema = z.object({
  id: idSchema,
  name: z.string(),
  initialSeedNum: z.number().nullable().optional(),
  participants: z
    .array(
      z.object({
        gamerTag: z.string(),
        prefix: z.string().nullable().optional(),
        user: z
          .object({
            genderPronoun: z.string().nullable().optional(),
            location: z
              .object({
                country: z.string().nullable().optional(),
                state: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .optional(),
});

const slotSchema = z.object({
  entrant: entrantSchema.nullable(),
  standing: z
    .object({
      stats: z
        .object({
          score: z
            .object({ value: z.number().nullable().optional() })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const rawSetSchema = z.object({
  id: idSchema,
  identifier: z.string().nullable().optional(),
  round: z.number().nullable().optional(),
  fullRoundText: z.string().nullable().optional(),
  state: z.number().nullable().optional(),
  winnerId: idSchema.nullable().optional(),
  slots: z.array(slotSchema.nullable()).nullable().optional(),
});

const eventResponseSchema = z.object({
  event: z
    .object({
      id: idSchema,
      name: z.string(),
      slug: z.string(),
      tournament: z.object({ name: z.string() }),
      phases: z
        .array(
          z
            .object({
              name: z.string(),
              phaseGroups: z
                .object({
                  nodes: z
                    .array(
                      z
                        .object({
                          id: idSchema,
                          displayIdentifier: z.string().nullable().optional(),
                          sets: z
                            .object({
                              nodes: z
                                .array(rawSetSchema.nullable())
                                .nullable()
                                .optional(),
                            })
                            .nullable()
                            .optional(),
                        })
                        .nullable(),
                    )
                    .nullable()
                    .optional(),
                })
                .nullable()
                .optional(),
            })
            .nullable(),
        )
        .nullable()
        .optional(),
    })
    .nullable(),
});

const setResponseSchema = z.object({
  set: rawSetSchema.nullable(),
});

const EVENT_METADATA_QUERY = gql`
  query TournamentOverlayEventMetadata($slug: String!) {
    event(slug: $slug) {
      id
      name
      slug
      tournament {
        name
      }
      phases {
        name
        phaseGroups(query: { perPage: 50 }) {
          nodes {
            id
            displayIdentifier
          }
        }
      }
    }
  }
`;

const PHASE_GROUP_SETS_QUERY = gql`
  query TournamentOverlayPhaseGroupSets(
    $id: ID!
    $page: Int!
    $perPage: Int!
  ) {
    phaseGroup(id: $id) {
      sets(page: $page, perPage: $perPage, sortType: STANDARD) {
        pageInfo {
          totalPages
        }
        nodes {
          id
          identifier
          round
          fullRoundText
          state
          winnerId
          slots {
            entrant {
              id
              name
              initialSeedNum
              participants {
                gamerTag
                prefix
                user {
                  genderPronoun
                  location {
                    country
                    state
                  }
                }
              }
            }
            standing {
              stats {
                score {
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SET_QUERY = gql`
  query TournamentOverlaySet($id: ID!) {
    set(id: $id) {
      id
      identifier
      round
      fullRoundText
      state
      winnerId
      slots {
        entrant {
          id
          name
          initialSeedNum
          participants {
            gamerTag
            prefix
            user {
              genderPronoun
              location {
                country
                state
              }
            }
          }
        }
        standing {
          stats {
            score {
              value
            }
          }
        }
      }
    }
  }
`;

type RawSet = z.infer<typeof rawSetSchema>;

const phaseGroupSetsResponseSchema = z.object({
  phaseGroup: z
    .object({
      sets: z
        .object({
          pageInfo: z.object({
            totalPages: z.number().int().nonnegative(),
          }),
          nodes: z.array(rawSetSchema.nullable()).nullable().optional(),
        })
        .nullable(),
    })
    .nullable(),
});

const SETS_PER_PAGE = 20;

export function parseStartGgEventInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ProviderError(
      "invalid_event",
      "Enter a StartGG event URL or event slug.",
    );
  }

  if (!trimmed.includes("://")) {
    const slug = trimmed.replace(/^\/+|\/+$/g, "");
    if (!slug.includes("/event/")) {
      throw new ProviderError(
        "invalid_event",
        'Use a full event slug such as "tournament/example/event/singles".',
      );
    }
    return slug;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (error) {
    throw new ProviderError(
      "invalid_event",
      "The StartGG event URL is not valid.",
      { cause: error },
    );
  }

  if (url.hostname !== "start.gg" && url.hostname !== "www.start.gg") {
    throw new ProviderError(
      "invalid_event",
      "Use an event URL from start.gg.",
    );
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const tournamentIndex = parts.indexOf("tournament");
  const eventIndex = parts.indexOf("event");
  if (
    tournamentIndex < 0 ||
    eventIndex < 0 ||
    eventIndex <= tournamentIndex + 1 ||
    parts[eventIndex + 1] === undefined
  ) {
    throw new ProviderError(
      "invalid_event",
      "Open the event page on StartGG and copy its full URL.",
    );
  }

  return parts.slice(tournamentIndex, eventIndex + 2).join("/");
}

function normalizeEntrant(
  entrant: z.infer<typeof entrantSchema>,
): EntrantProfile {
  const participant = entrant.participants?.[0];
  const location = participant?.user?.location;
  return {
    id: entrant.id,
    name: participant?.gamerTag ?? entrant.name,
    prefix: participant?.prefix ?? null,
    seed: entrant.initialSeedNum ?? null,
    pronouns: participant?.user?.genderPronoun ?? null,
    social: null,
    location:
      location === null || location === undefined
        ? null
        : {
            country: location.country ?? null,
            state: location.state ?? null,
          },
  };
}

function normalizeSetState(state: number | null | undefined): NormalizedSet["state"] {
  if (state === 3) {
    return "completed";
  }
  if (state === 2) {
    return "active";
  }
  return "pending";
}

function normalizeSet(
  rawSet: RawSet,
  phaseGroupId: string,
  phaseName: string,
): NormalizedSet {
  const slots = (rawSet.slots ?? []).slice(0, 2).map((slot) => {
    if (slot?.entrant === null || slot?.entrant === undefined) {
      return null;
    }
    return {
      entrant: normalizeEntrant(slot.entrant),
      score: slot.standing?.stats?.score?.value ?? null,
    };
  });

  return {
    id: rawSet.id,
    identifier: rawSet.identifier ?? rawSet.id,
    phaseGroupId,
    phaseName,
    round: {
      name: rawSet.fullRoundText ?? `Round ${String(rawSet.round ?? 0)}`,
      order: rawSet.round ?? 0,
    },
    state: normalizeSetState(rawSet.state),
    winnerId: rawSet.winnerId ?? null,
    entrants: [slots[0] ?? null, slots[1] ?? null],
  };
}

export function normalizeStartGgEvent(
  input: unknown,
  fetchedAt = new Date().toISOString(),
): NormalizedEvent {
  const parsed = eventResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProviderError(
      "invalid_response",
      "StartGG returned tournament data in an unexpected shape.",
      { cause: parsed.error },
    );
  }
  if (parsed.data.event === null) {
    throw new ProviderError(
      "event_not_found",
      "StartGG could not find that event. Check the URL or slug.",
    );
  }

  const event = parsed.data.event;
  const phaseGroups = (event.phases ?? []).flatMap((phase) => {
    if (phase === null) {
      return [];
    }
    return (phase.phaseGroups?.nodes ?? []).flatMap((group) => {
      if (group === null) {
        return [];
      }
      return [
        {
          id: group.id,
          name: group.displayIdentifier ?? phase.name,
          phaseName: phase.name,
          sets: (group.sets?.nodes ?? []).flatMap((set) =>
            set === null ? [] : [normalizeSet(set, group.id, phase.name)],
          ),
        },
      ];
    });
  });

  return {
    id: event.id,
    providerId: "startgg",
    slug: event.slug,
    name: event.name,
    tournamentName: event.tournament.name,
    phaseGroups,
    fetchedAt,
  };
}

export class StartGgProvider implements TournamentDataProvider {
  public readonly descriptor: ProviderDescriptor;
  readonly #client: GraphQLClient | null;

  public constructor(token: string | undefined) {
    const configured = token !== undefined && token.trim().length > 0;
    this.descriptor = {
      id: "startgg",
      name: "StartGG",
      configured,
    };
    this.#client = configured
      ? new GraphQLClient(STARTGG_ENDPOINT, {
          headers: { authorization: `Bearer ${token.trim()}` },
        })
      : null;
  }

  public async loadEvent(input: string): Promise<NormalizedEvent> {
    const client = this.#requireClient();
    const slug = parseStartGgEventInput(input);
    const response: unknown = await client.request(EVENT_METADATA_QUERY, { slug });
    const event = normalizeStartGgEvent(response);
    const phaseGroups = [];

    for (const phaseGroup of event.phaseGroups) {
      phaseGroups.push({
        ...phaseGroup,
        sets: await this.#loadPhaseGroupSets(
          client,
          phaseGroup.id,
          phaseGroup.phaseName,
        ),
      });
    }

    return {
      ...event,
      phaseGroups,
      fetchedAt: new Date().toISOString(),
    };
  }

  public async loadSet(
    setId: string,
    event: NormalizedEvent,
  ): Promise<NormalizedSet> {
    const client = this.#requireClient();
    const existing = event.phaseGroups
      .flatMap((phaseGroup) => phaseGroup.sets)
      .find((set) => set.id === setId);
    if (existing === undefined) {
      throw new ProviderError(
        "set_not_found",
        `Set "${setId}" is not part of the selected event.`,
      );
    }

    const response: unknown = await client.request(SET_QUERY, { id: setId });
    const parsed = setResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new ProviderError(
        "invalid_response",
        "StartGG returned set data in an unexpected shape.",
        { cause: parsed.error },
      );
    }
    if (parsed.data.set === null) {
      throw new ProviderError(
        "set_not_found",
        "The selected set is no longer available on StartGG.",
      );
    }

    return normalizeSet(
      parsed.data.set,
      existing.phaseGroupId,
      existing.phaseName,
    );
  }

  #requireClient(): GraphQLClient {
    if (this.#client === null) {
      throw new ProviderError(
        "missing_token",
        "StartGG is not configured. Add STARTGG_API_TOKEN to .env and restart the server.",
      );
    }
    return this.#client;
  }

  async #loadPhaseGroupSets(
    client: GraphQLClient,
    phaseGroupId: string,
    phaseName: string,
  ): Promise<NormalizedSet[]> {
    const sets: NormalizedSet[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const response: unknown = await client.request(PHASE_GROUP_SETS_QUERY, {
        id: phaseGroupId,
        page,
        perPage: SETS_PER_PAGE,
      });
      const parsed = phaseGroupSetsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new ProviderError(
          "invalid_response",
          "StartGG returned phase group sets in an unexpected shape.",
          { cause: parsed.error },
        );
      }
      if (parsed.data.phaseGroup === null) {
        throw new ProviderError(
          "phase_group_not_found",
          `StartGG could not find phase group "${phaseGroupId}".`,
        );
      }

      const connection = parsed.data.phaseGroup.sets;
      if (connection === null) {
        return sets;
      }

      totalPages = connection.pageInfo.totalPages;
      for (const rawSet of connection.nodes ?? []) {
        if (rawSet !== null) {
          sets.push(normalizeSet(rawSet, phaseGroupId, phaseName));
        }
      }
      page += 1;
    }

    return sets;
  }
}
