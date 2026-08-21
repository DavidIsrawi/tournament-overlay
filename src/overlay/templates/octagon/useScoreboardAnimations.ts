import type {
  OverlayAnimationEvent,
  OverlaySide,
  ScoreAnimationEvent,
} from "../../../shared/overlay-events.ts";
import {
  cancelAnimations,
  prefersReducedMotion,
  runSetEntrance,
  SCORE_WHEEL_EASE,
  WHEEL_EASE,
} from "./animations.ts";
import {
  useEffect,
  useRef,
  useState,
} from "react";

export interface ScorePulse {
  readonly side: OverlaySide;
  readonly sequence: number;
}

export function useScoreboardAnimations(
  animationEvents: readonly OverlayAnimationEvent[],
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const entranceAnimations = useRef<Animation[]>([]);
  const entranceFrame = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const [wheel, setWheel] = useState({
    turn: 0,
    duration: 2_400,
    easing: WHEEL_EASE,
  });
  const [pulse, setPulse] = useState<ScorePulse | null>(null);

  useEffect(() => {
    entranceFrame.current = window.requestAnimationFrame(() => {
      if (rootRef.current === null) {
        return;
      }
      entranceAnimations.current = runSetEntrance(rootRef.current, true);
      if (!prefersReducedMotion()) {
        setWheel((current) => ({
          turn: current.turn + 360,
          duration: 2_400,
          easing: WHEEL_EASE,
        }));
      }
    });
    return () => {
      if (entranceFrame.current !== null) {
        window.cancelAnimationFrame(entranceFrame.current);
      }
      cancelAnimations(entranceAnimations.current);
    };
  }, []);

  useEffect(() => {
    const setEvent = animationEvents.findLast(
      (event) => event.type === "set.loaded",
    );
    const scoreEvents = animationEvents.filter(
      (event): event is ScoreAnimationEvent => event.type === "score.changed",
    );

    if (setEvent !== undefined) {
      if (entranceFrame.current !== null) {
        window.cancelAnimationFrame(entranceFrame.current);
      }
      entranceFrame.current = window.requestAnimationFrame(() => {
        if (rootRef.current === null) {
          return;
        }
        cancelAnimations(entranceAnimations.current);
        entranceAnimations.current = runSetEntrance(rootRef.current, false);
      });
      if (!prefersReducedMotion()) {
        setWheel((current) => ({
          turn: current.turn + 360,
          duration: 2_400,
          easing: WHEEL_EASE,
        }));
      }
      return;
    }

    const scoreEvent = scoreEvents.at(-1);
    if (scoreEvent !== undefined) {
      if (pulseTimer.current !== null) {
        window.clearTimeout(pulseTimer.current);
      }
      setPulse({ side: scoreEvent.side, sequence: scoreEvent.sequence });
      pulseTimer.current = window.setTimeout(() => {
        setPulse(null);
        pulseTimer.current = null;
      }, 360);
      if (!prefersReducedMotion()) {
        const turn = scoreEvents.reduce(
          (total, event) =>
            total + (event.side === "port" ? -45 : 45),
          0,
        );
        setWheel((current) => ({
          turn: current.turn + turn,
          duration: 620,
          easing: SCORE_WHEEL_EASE,
        }));
      }
    }
  }, [animationEvents]);

  useEffect(
    () => () => {
      if (pulseTimer.current !== null) {
        window.clearTimeout(pulseTimer.current);
      }
    },
    [],
  );

  const portScoreEvent = animationEvents.findLast(
    (event): event is ScoreAnimationEvent =>
      event.type === "score.changed" && event.side === "port",
  );
  const starboardScoreEvent = animationEvents.findLast(
    (event): event is ScoreAnimationEvent =>
      event.type === "score.changed" && event.side === "starboard",
  );

  return {
    portScoreEvent,
    pulse,
    rootRef,
    starboardScoreEvent,
    wheel,
  };
}
