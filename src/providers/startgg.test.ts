import { describe, expect, it } from "vitest";
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

function metadataResponse(): unknown {
  return {
    data: {
      event: {
        id: 10,
        name: "Ultimate Singles",
        slug: "tournament/octagon/event/ultimate",
        tournament: { name: "Octagon Open" },
        phases: [
          {
            name: "Pools",
            phaseGroups: {
              nodes: [{ id: 20, displayIdentifier: "A1" }],
            },
          },
        ],
      },
    },
  };
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
                                name: "Port",
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
    });
    expect(event.phaseGroups[0]?.sets[0]?.entrants[1]).toBeNull();
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
      sets: [],
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
