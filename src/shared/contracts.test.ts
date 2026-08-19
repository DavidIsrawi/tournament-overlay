import { describe, expect, it } from "vitest";
import {
  deriveOverlayView,
  type NormalizedEvent,
  type NormalizedSet,
} from "./contracts.ts";

const set: NormalizedSet = {
  id: "set-1",
  identifier: "A1",
  phaseGroupId: "group-1",
  phaseName: "Top 8",
  round: { name: "Winners Final", order: 1 },
  state: "active",
  winnerId: null,
  entrants: [
    {
      entrant: {
        id: "p1",
        name: "Port",
        prefix: "PNW",
        seed: 1,
        pronouns: "he/him",
        social: "@port",
        location: { state: "WA", country: "US" },
      },
      score: 2,
    },
    {
      entrant: {
        id: "p2",
        name: "Starboard",
        prefix: null,
        seed: 2,
        pronouns: "she/her",
        social: null,
        location: null,
      },
      score: 1,
    },
  ],
};

const event: NormalizedEvent = {
  id: "event-1",
  providerId: "demo",
  slug: "demo/octagon-open",
  name: "Ultimate Singles",
  tournamentName: "Octagon Open",
  phaseGroups: [
    { id: "group-1", name: "Top 8", phaseName: "Top 8", sets: [set] },
  ],
  fetchedAt: "2026-08-19T00:00:00.000Z",
};

describe("deriveOverlayView", () => {
  it("swaps presentation sides without mutating normalized source data", () => {
    const originalFirst = set.entrants[0];
    const view = deriveOverlayView(
      4,
      event,
      set,
      { sideOrder: "swapped" },
      "fresh",
    );

    expect(view.players[0]?.sourceEntrantId).toBe("p2");
    expect(view.players[1]?.sourceEntrantId).toBe("p1");
    expect(set.entrants[0]).toBe(originalFirst);
    expect(set.entrants[0]?.entrant.id).toBe("p1");
  });
});
