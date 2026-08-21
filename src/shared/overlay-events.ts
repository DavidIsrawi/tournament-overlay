import type { OverlayView } from "./contracts.ts";

export type OverlaySide = "port" | "starboard";

export type OverlayAnimationEvent =
  | {
      readonly sequence: number;
      readonly type: "set.loaded";
      readonly setId: string;
    }
  | {
      readonly sequence: number;
      readonly type: "score.changed";
      readonly side: OverlaySide;
      readonly previousScore: number;
      readonly score: number;
    };

export type ScoreAnimationEvent = Extract<
  OverlayAnimationEvent,
  { readonly type: "score.changed" }
>;

export function deriveOverlayAnimationEvents(
  previous: OverlayView | null,
  next: OverlayView,
  startingSequence: number,
): readonly OverlayAnimationEvent[] {
  if (previous === null) {
    return [];
  }

  if (previous.setId !== next.setId) {
    return next.setId === null
      ? []
      : [
          {
            sequence: startingSequence,
            type: "set.loaded",
            setId: next.setId,
          },
        ];
  }

  if (next.setId === null) {
    return [];
  }

  const events: OverlayAnimationEvent[] = [];
  const sides = [
    {
      side: "port",
      previousPlayer: previous.players[0],
      nextPlayer: next.players[0],
    },
    {
      side: "starboard",
      previousPlayer: previous.players[1],
      nextPlayer: next.players[1],
    },
  ] as const;
  for (const { side, previousPlayer, nextPlayer } of sides) {
    if (
      previousPlayer === null ||
      nextPlayer === null ||
      previousPlayer.sourceEntrantId !== nextPlayer.sourceEntrantId ||
      previousPlayer.score === null ||
      nextPlayer.score === null ||
      previousPlayer.score === nextPlayer.score
    ) {
      continue;
    }

    events.push({
      sequence: startingSequence + events.length,
      type: "score.changed",
      side,
      previousScore: previousPlayer.score,
      score: nextPlayer.score,
    });
  }
  return events;
}
