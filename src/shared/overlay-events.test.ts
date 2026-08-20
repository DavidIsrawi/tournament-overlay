import { describe, expect, it } from "vitest";
import type { OverlayPlayer, OverlayView } from "./contracts.ts";
import { deriveOverlayAnimationEvents } from "./overlay-events.ts";

function player(id: string, score: number | null): OverlayPlayer {
  return {
    sourceEntrantId: id,
    displayName: id,
    prefix: null,
    score,
    seed: null,
    pronouns: null,
    social: null,
    location: null,
    country: null,
    isWinner: false,
  };
}

function view(
  setId: string | null,
  players: OverlayView["players"],
): OverlayView {
  return {
    revision: 1,
    status: setId === null ? "empty" : "ready",
    setId,
    tournamentName: "Octagon Open",
    eventName: "Singles",
    phaseName: "Top 8",
    roundName: "Winners Final",
    players,
  };
}

describe("deriveOverlayAnimationEvents", () => {
  it("emits one entrance event when a different set is loaded", () => {
    expect(
      deriveOverlayAnimationEvents(
        view("set-1", [player("p1", 0), player("p2", 0)]),
        view("set-2", [player("p3", 0), player("p4", 0)]),
        12,
      ),
    ).toEqual([{ sequence: 12, type: "set.loaded", setId: "set-2" }]);
  });

  it("emits score events for stable entrants on the current set", () => {
    expect(
      deriveOverlayAnimationEvents(
        view("set-1", [player("p1", 1), player("p2", 2)]),
        view("set-1", [player("p1", 2), player("p2", 3)]),
        20,
      ),
    ).toEqual([
      {
        sequence: 20,
        type: "score.changed",
        side: "port",
        previousScore: 1,
        score: 2,
      },
      {
        sequence: 21,
        type: "score.changed",
        side: "starboard",
        previousScore: 2,
        score: 3,
      },
    ]);
  });

  it("does not treat entrant loading or a side swap as a score change", () => {
    expect(
      deriveOverlayAnimationEvents(
        view("set-1", [null, null]),
        view("set-1", [player("p1", 0), player("p2", 0)]),
        1,
      ),
    ).toEqual([]);

    expect(
      deriveOverlayAnimationEvents(
        view("set-1", [player("p1", 1), player("p2", 2)]),
        view("set-1", [player("p2", 2), player("p1", 1)]),
        1,
      ),
    ).toEqual([]);
  });
});
