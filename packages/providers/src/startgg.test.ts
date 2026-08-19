import { describe, expect, it } from "vitest";
import {
  normalizeStartGgEvent,
  parseStartGgEventInput,
  ProviderError,
} from "./index.ts";

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
