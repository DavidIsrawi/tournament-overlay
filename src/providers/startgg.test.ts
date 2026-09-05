import { describe, expect, it, vi } from "vitest";
import {
  normalizeStartGgEvent,
  parseStartGgEventInput,
  ProviderError,
  StartGgProvider,
} from "./index.ts";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function metadataPhase(
  id: number,
  totalPages: number,
  groupIds: readonly number[],
  name = "Pools",
) {
  return {
    id,
    name,
    phaseGroups: {
      pageInfo: { totalPages },
      nodes: groupIds.map((groupId) => ({
        id: groupId,
        displayIdentifier: `Group ${String(groupId)}`,
      })),
    },
  };
}

function metadataResponse(
  phases: readonly unknown[] | null = [metadataPhase(100, 1, [20])],
): unknown {
  return {
    data: {
      event: {
        id: 10,
        name: "Ultimate Singles",
        slug: "tournament/octagon/event/ultimate",
        tournament: { name: "Octagon Open" },
        phases,
      },
    },
  };
}

function readRequest(init: RequestInit | undefined): {
  query: string;
  variables: {
    id?: string;
    slug?: string;
    page?: number;
    perPage?: number;
  };
} {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return JSON.parse(init.body) as ReturnType<typeof readRequest>;
}

function setNode(id: number): unknown {
  return {
    id,
    identifier: `A${String(id)}`,
    round: 1,
    fullRoundText: "Round 1",
    state: 1,
    winnerId: null,
    slots: [
      {
        entrant: {
          id: id + 100,
          name: `Player ${String(id)}`,
          initialSeedNum: id,
        },
        standing: { stats: { score: { value: 0 } } },
      },
    ],
  };
}

describe("parseStartGgEventInput", () => {
  it("normalizes full event URLs and removes query parameters", () => {
    expect(
      parseStartGgEventInput(
        "https://www.start.gg/tournament/octagon-open/event/ultimate-singles?tab=overview",
      ),
    ).toBe("tournament/octagon-open/event/ultimate-singles");
  });

  it("accepts normalized event slugs", () => {
    expect(
      parseStartGgEventInput("tournament/octagon-open/event/ultimate-singles"),
    ).toBe("tournament/octagon-open/event/ultimate-singles");
  });

  it("rejects non-StartGG URLs", () => {
    expect(() =>
      parseStartGgEventInput(
        "https://example.com/tournament/octagon/event/singles",
      ),
    ).toThrow(ProviderError);
  });
});

describe("normalizeStartGgEvent", () => {
  it("maps provider responses into normalized provider-neutral models", () => {
    const event = normalizeStartGgEvent(
      {
        event: {
          id: 10,
          name: "Ultimate Singles",
          slug: "tournament/octagon/event/ultimate",
          tournament: { name: "Octagon Open" },
          phases: [
            {
              name: "Top 8",
              phaseGroups: {
                nodes: [
                  {
                    id: 20,
                    displayIdentifier: "Top 8",
                    sets: {
                      nodes: [
                        {
                          id: 30,
                          identifier: "WF",
                          round: 1,
                          fullRoundText: "Winners Final",
                          state: 2,
                          winnerId: null,
                          slots: [
                            {
                              entrant: {
                                id: 40,
                                name: "PNW | Port",
                                initialSeedNum: 1,
                                participants: [
                                  {
                                    gamerTag: "Port",
                                    prefix: "PNW",
                                    user: {
                                      genderPronoun: "he/him",
                                      location: {
                                        country: "US",
                                        state: "WA",
                                      },
                                    },
                                  },
                                ],
                              },
                              standing: {
                                stats: { score: { value: 2 } },
                              },
                            },
                            null,
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      "2026-08-19T00:00:00.000Z",
    );

    expect(event.providerId).toBe("startgg");
    expect(event.phaseGroups[0]?.setsLoaded).toBe(true);
    expect(event.phaseGroups[0]?.setsFetchedAt).toBe("2026-08-19T00:00:00.000Z");
    expect(event.phaseGroups[0]?.sets[0]).toMatchObject({
      id: "30",
      phaseGroupId: "20",
      phaseName: "Top 8",
      state: "active",
      winnerId: null,
    });
    expect(event.phaseGroups[0]?.sets[0]?.entrants[0]?.entrant).toMatchObject({
      id: "40",
      name: "Port",
      prefix: "PNW",
      seed: 1,
      pronouns: "he/him",
      location: { country: "US", state: "WA" },
    });
    expect(event.phaseGroups[0]?.sets[0]?.entrants[1]).toBeNull();
  });

  it("preserves named doubles entrants without assigning an individual's profile to the team", () => {
    const event = normalizeStartGgEvent({
      event: {
        id: 10,
        name: "Doubles",
        slug: "tournament/octagon/event/doubles",
        tournament: { name: "Octagon Open" },
        phases: [{
          name: "Finals",
          phaseGroups: {
            nodes: [{
              id: 20,
              sets: {
                nodes: [{
                  id: 30,
                  slots: [{
                    entrant: {
                      id: 40,
                      name: "Port & Starboard",
                      initialSeedNum: 3,
                      participants: [
                        {
                          gamerTag: "Port",
                          prefix: "PNW",
                          user: {
                            genderPronoun: "he/him",
                            location: { country: "US", state: "WA" },
                          },
                        },
                        { gamerTag: "Starboard", prefix: "ATL" },
                      ],
                    },
                  }],
                }],
              },
            }],
          },
        }],
      },
    });

    expect(event.phaseGroups[0]?.sets[0]?.entrants[0]?.entrant).toEqual({
      id: "40",
      name: "Port & Starboard",
      seed: 3,
      prefix: null,
      pronouns: null,
      social: null,
      location: null,
    });
  });

  it.each([undefined, []])("preserves entrant identity when participants are %j", (participants) => {
    const event = normalizeStartGgEvent({
      event: {
        id: 10,
        name: "Singles",
        slug: "tournament/octagon/event/singles",
        tournament: { name: "Octagon Open" },
        phases: [{
          name: "Pools",
          phaseGroups: {
            nodes: [{
              id: 20,
              sets: {
                nodes: [{
                  id: 30,
                  slots: [{
                    entrant: {
                      id: 40,
                      name: "Port",
                      initialSeedNum: 1,
                      participants,
                    },
                  }],
                }],
              },
            }],
          },
        }],
      },
    });

    expect(event.phaseGroups[0]?.sets[0]?.entrants[0]?.entrant).toEqual({
      id: "40",
      name: "Port",
      seed: 1,
      prefix: null,
      pronouns: null,
      social: null,
      location: null,
    });
  });
});

describe("StartGgProvider", () => {
  it("loads event metadata without eagerly loading phase-group sets", async () => {
    let requestCount = 0;
    const provider = new StartGgProvider("token", {
      fetch: () => {
        requestCount += 1;
        return Promise.resolve(jsonResponse(metadataResponse()));
      },
      requestIntervalMs: 0,
    });

    const event = await provider.loadEvent(
      "tournament/octagon/event/ultimate",
    );

    expect(requestCount).toBe(1);
    expect(event.phaseGroups[0]).toMatchObject({
      id: "20",
      setsLoaded: false,
      setsFetchedAt: null,
      sets: [],
    });
  });

  it("loads every metadata page for phases with different page counts without duplicating groups", async () => {
    const ids = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => start + index);
    const requests: ReturnType<typeof readRequest>[] = [];
    const provider = new StartGgProvider("token", {
      fetch: (_input, init) => {
        const request = readRequest(init);
        requests.push(request);
        if (request.variables.slug !== undefined) {
          return Promise.resolve(jsonResponse(metadataResponse([
            metadataPhase(100, 2, ids(1, 50)),
            metadataPhase(200, 1, [200], "Top 8"),
            metadataPhase(300, 3, ids(301, 50), "Consolation"),
          ])));
        }

        const phaseId = Number(request.variables.id);
        const page = request.variables.page;
        const groupIds = phaseId === 100
          ? [50, 51]
          : page === 2
            ? [350, ...ids(351, 49)]
            : [399, 400, 401];
        const phase = metadataPhase(phaseId, phaseId === 100 ? 2 : 3, groupIds);
        return Promise.resolve(jsonResponse({ data: { phase } }));
      },
      requestIntervalMs: 0,
    });

    const event = await provider.loadEvent("tournament/octagon/event/ultimate");

    expect(requests.map(({ variables }) => variables)).toEqual([
      { slug: "tournament/octagon/event/ultimate", perPage: 50 },
      { id: "100", page: 2, perPage: 50 },
      { id: "300", page: 2, perPage: 50 },
      { id: "300", page: 3, perPage: 50 },
    ]);
    expect(requests[0]?.query).toContain("page: 1");
    expect(requests.every(({ query }) => query.includes("totalPages"))).toBe(true);
    expect(requests.every(({ query }) => !query.includes("sets"))).toBe(true);
    expect(event.phaseGroups.map(({ id }) => id)).toEqual(
      [...ids(1, 51), 200, ...ids(301, 101)].map(String),
    );
    expect(new Set(event.phaseGroups.map(({ id }) => id)).size).toBe(153);
    expect(event.phaseGroups.filter(({ phaseName }) => phaseName === "Pools")).toHaveLength(51);
    expect(event.phaseGroups.filter(({ phaseName }) => phaseName === "Consolation")).toHaveLength(101);
    expect(event.phaseGroups.every((group) =>
      group.setsLoaded === false &&
      group.setsFetchedAt === null &&
      group.sets.length === 0 &&
      !("pageInfo" in group),
    )).toBe(true);
  });

  it("supports null and empty metadata collections without extra requests", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(metadataResponse([
      null,
      { id: 100, name: "Empty phase", phaseGroups: null },
      metadataPhase(200, 0, [], "Not started"),
      {
        id: 300,
        name: "Pools",
        phaseGroups: {
          pageInfo: { totalPages: 1 },
          nodes: [null, { id: 20, displayIdentifier: null }],
        },
      },
    ]))));
    const provider = new StartGgProvider("token", {
      fetch: fetchMock,
      requestIntervalMs: 0,
    });

    const event = await provider.loadEvent("tournament/octagon/event/ultimate");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(event.phaseGroups).toEqual([{
      id: "20",
      name: "Pools",
      phaseName: "Pools",
      setsLoaded: false,
      setsFetchedAt: null,
      sets: [],
    }]);
  });

  it.each([null, []])("supports events with phases %j", async (phases) => {
    const provider = new StartGgProvider("token", {
      fetch: () => Promise.resolve(jsonResponse(metadataResponse(phases))),
      requestIntervalMs: 0,
    });

    await expect(provider.loadEvent("tournament/octagon/event/ultimate")).resolves.toMatchObject({
      phaseGroups: [],
    });
  });

  it.each([
    { phaseGroups: { nodes: [] } },
    { phaseGroups: { pageInfo: { totalPages: 1 } } },
    { phaseGroups: { pageInfo: { totalPages: -1 }, nodes: [] } },
    { phaseGroups: { pageInfo: { totalPages: 1.5 }, nodes: [] } },
    { phaseGroups: { pageInfo: { totalPages: "2" }, nodes: [] } },
    { phaseGroups: { pageInfo: { totalPages: 1 }, nodes: [{ displayIdentifier: "A1" }] } },
    { id: undefined },
  ])("rejects malformed initial metadata rather than accepting incomplete results (%j)", async (override) => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(metadataResponse([
      { ...metadataPhase(100, 1, [20]), ...override },
    ]))));
    const provider = new StartGgProvider("token", {
      fetch: fetchMock,
      requestIntervalMs: 0,
    });

    await expect(provider.loadEvent("tournament/octagon/event/ultimate")).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { id: 100, phaseGroups: null },
    { id: 100, phaseGroups: { nodes: [] } },
    { id: 100, phaseGroups: { pageInfo: { totalPages: 2 } } },
    { id: 100, phaseGroups: { pageInfo: { totalPages: 2 }, nodes: [{ id: null }] } },
    metadataPhase(999, 2, [21]),
  ])("rejects malformed or missing later metadata instead of returning a partial event (%j)", async (phase) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(metadataResponse([metadataPhase(100, 2, [20])])))
      .mockResolvedValueOnce(jsonResponse({ data: { phase } }));
    const provider = new StartGgProvider("token", {
      fetch: fetchMock,
      requestIntervalMs: 0,
    });

    await expect(provider.loadEvent("tournament/octagon/event/ultimate")).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the event-not-found error for null event metadata", async () => {
    const provider = new StartGgProvider("token", {
      fetch: () => Promise.resolve(jsonResponse({ data: { event: null } })),
      requestIntervalMs: 0,
    });

    await expect(provider.loadEvent("tournament/octagon/event/ultimate")).rejects.toMatchObject({
      code: "event_not_found",
    });
  });

  it("paces additional metadata pages through the request queue", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(metadataResponse([metadataPhase(100, 2, [20])])))
        .mockResolvedValueOnce(jsonResponse({ data: { phase: metadataPhase(100, 2, [21]) } }));
      const provider = new StartGgProvider("token", {
        fetch: fetchMock,
        requestIntervalMs: 1_000,
      });

      const eventPromise = provider.loadEvent("tournament/octagon/event/ultimate");
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      const event = await eventPromise;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(event.phaseGroups.map(({ id }) => id)).toEqual(["20", "21"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts while pacing a later metadata page without returning a partial event", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(metadataResponse([
        metadataPhase(100, 2, [20]),
      ]))));
      const provider = new StartGgProvider("token", {
        fetch: fetchMock,
        requestIntervalMs: 1_000,
      });
      const result = expect(provider.loadEvent("tournament/octagon/event/ultimate", {
        signal: controller.signal,
      })).rejects.toMatchObject({ name: "AbortError" });

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      controller.abort();
      await result;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not request metadata for an already-aborted load", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(metadataResponse())));
    const provider = new StartGgProvider("token", {
      fetch: fetchMock,
      requestIntervalMs: 0,
    });

    await expect(provider.loadEvent("tournament/octagon/event/ultimate", {
      signal: AbortSignal.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards cancellation to an in-flight metadata page and stops pagination", async () => {
    const controller = new AbortController();
    let pageStarted: (() => void) | undefined;
    const waitingForPage = new Promise<void>((resolve) => {
      pageStarted = resolve;
    });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (readRequest(init).variables.slug !== undefined) {
        return Promise.resolve(jsonResponse(metadataResponse([metadataPhase(100, 3, [20])])));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Metadata request cancelled."));
        }, { once: true });
        pageStarted?.();
      });
    });
    const provider = new StartGgProvider("token", {
      fetch: fetchMock,
      requestIntervalMs: 0,
    });
    const result = expect(provider.loadEvent("tournament/octagon/event/ultimate", {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    await waitingForPage;
    controller.abort();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps team identity and individual profiles distinct when refreshing rich set details", async () => {
    const event = normalizeStartGgEvent({
      event: {
        id: 10,
        name: "Mixed entrants",
        slug: "tournament/octagon/event/mixed",
        tournament: { name: "Octagon Open" },
        phases: [{
          name: "Pools",
          phaseGroups: { nodes: [{ id: 20, sets: { nodes: [setNode(30)] } }] },
        }],
      },
    });
    const provider = new StartGgProvider("token", {
      fetch: (_input, init) => {
        const request = readRequest(init);
        expect(request.variables).toEqual({ id: "30" });
        expect(request.query).toContain("participants");
        return Promise.resolve(jsonResponse({
          data: {
            set: {
              id: 30,
              slots: [
                {
                  entrant: {
                    id: 40,
                    name: "Port & Starboard",
                    initialSeedNum: 2,
                    participants: [
                      {
                        gamerTag: "Port",
                        prefix: "PNW",
                        user: {
                          genderPronoun: "he/him",
                          location: { country: "US", state: "WA" },
                        },
                      },
                      { gamerTag: "Starboard" },
                    ],
                  },
                },
                {
                  entrant: {
                    id: 50,
                    name: "ATL | Solo",
                    initialSeedNum: 1,
                    participants: [{
                      gamerTag: "Solo",
                      prefix: "ATL",
                      user: {
                        genderPronoun: "they/them",
                        location: { country: "US", state: "GA" },
                      },
                    }],
                  },
                },
              ],
            },
          },
        }));
      },
      requestIntervalMs: 0,
    });

    const refreshed = await provider.loadSet("30", event);

    expect(refreshed.entrants[0]?.entrant).toEqual({
      id: "40",
      name: "Port & Starboard",
      seed: 2,
      prefix: null,
      pronouns: null,
      social: null,
      location: null,
    });
    expect(refreshed.entrants[1]?.entrant).toEqual({
      id: "50",
      name: "Solo",
      seed: 1,
      prefix: "ATL",
      pronouns: "they/them",
      social: null,
      location: { country: "US", state: "GA" },
    });
  });

  it("loads lightweight phase-group pages sequentially and reports progress", async () => {
    const pages: number[] = [];
    const queries: string[] = [];
    const progress: number[] = [];
    const provider = new StartGgProvider("token", {
      fetch: (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body.");
        }
        const request = JSON.parse(init.body) as {
          query: string;
          variables: { page: number };
        };
        pages.push(request.variables.page);
        queries.push(request.query);
        return Promise.resolve(
          jsonResponse({
            data: {
              phaseGroup: {
                sets: {
                  pageInfo: { totalPages: 2 },
                  nodes: [setNode(request.variables.page)],
                },
              },
            },
          }),
        );
      },
      requestIntervalMs: 0,
    });

    const sets = await provider.loadPhaseGroupSets("20", "Pools", {
      onProgress: (value) => {
        progress.push(value.loadedPages);
      },
    });

    expect(pages).toEqual([1, 2]);
    expect(progress).toEqual([1, 2]);
    expect(sets).toHaveLength(2);
    expect(queries.every((query) => !query.includes("genderPronoun"))).toBe(
      true,
    );
  });

  it("backs off and retries rate-limited requests", async () => {
    let requestCount = 0;
    const provider = new StartGgProvider("token", {
      fetch: () => {
        requestCount += 1;
        return Promise.resolve(
          requestCount === 1
            ? jsonResponse(
                {
                  success: false,
                  message: "Please wait before sending another request",
                },
                429,
              )
            : jsonResponse(metadataResponse()),
        );
      },
      requestIntervalMs: 0,
      rateLimitRetryDelaysMs: [0],
    });

    await expect(
      provider.loadEvent("tournament/octagon/event/ultimate"),
    ).resolves.toMatchObject({ id: "10" });
    expect(requestCount).toBe(2);
  });
});
