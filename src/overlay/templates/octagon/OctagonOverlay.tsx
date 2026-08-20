import type {
  OverlayPlayer,
  OverlayView,
} from "../../../shared/contracts.ts";
import { countryFlagEmoji } from "../../../shared/country-flags.ts";
import type { OverlayAnimationEvent } from "../../../shared/overlay-events.ts";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { OverlayTemplateProps } from "../../types.ts";
import "./styles.css";

type ScoreAnimationEvent = Extract<
  OverlayAnimationEvent,
  { readonly type: "score.changed" }
>;

const SET_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const WHEEL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SCORE_WHEEL_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animateElement(
  element: Element | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  cancelExisting = true,
): Animation | null {
  if (element === null) {
    return null;
  }
  if (cancelExisting) {
    for (const animation of element.getAnimations()) {
      animation.cancel();
    }
  }
  return element.animate(keyframes, options);
}

function runSetEntrance(root: HTMLElement, initial: boolean): Animation[] {
  if (reducedMotion()) {
    return [];
  }

  const animations: Animation[] = [];
  const add = (animation: Animation | null): void => {
    if (animation !== null) {
      animations.push(animation);
    }
  };
  const fadeOptions = {
    duration: 200,
    easing: SET_EASE,
    fill: "backwards" as const,
  };

  add(
    animateElement(
      root.querySelector(".player--port"),
      [
        { opacity: 0, transform: "translateX(-20px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      fadeOptions,
    ),
  );
  add(
    animateElement(
      root.querySelector(".player--starboard"),
      [
        { opacity: 0, transform: "translateX(20px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      fadeOptions,
    ),
  );

  for (const selector of [
    ".match-plate",
    ".event-plate",
    ...(initial ? [".helm-rig"] : [".helm-rig", ".tentacle"]),
  ]) {
    add(
      animateElement(
        root.querySelector(selector),
        [{ opacity: 0 }, { opacity: 1 }],
        fadeOptions,
      ),
    );
  }

  for (const side of ["port", "starboard"]) {
    const chips = Array.from(
      root.querySelectorAll(`.player--${side} .chip`),
    ).reverse();
    for (const [index, chip] of chips.entries()) {
      add(
        animateElement(
          chip,
          [{ opacity: 0 }, { opacity: 1 }],
          {
            duration: 200,
            delay: index * 50,
            fill: "backwards",
          },
        ),
      );
    }
  }

  if (initial) {
    add(
      animateElement(
        root.querySelector(".helm-rig"),
        [
          {
            transform: "translateX(-50%) rotate(-3deg) scale(0.94)",
          },
          { transform: "translateX(-50%) rotate(0) scale(1)" },
        ],
        {
          duration: 450,
          easing: SCORE_WHEEL_EASE,
          fill: "backwards",
        },
        false,
      ),
    );
    add(
      animateElement(
        root.querySelector(".tentacle"),
        [
          { opacity: 0, transform: "translateX(-18px)" },
          { opacity: 1, transform: "translateX(0)" },
        ],
        {
          duration: 500,
          delay: 80,
          easing: SET_EASE,
          fill: "backwards",
        },
      ),
    );
  }

  return animations;
}

function Score({
  value,
  side,
  event,
}: {
  readonly value: number | null;
  readonly side: "port" | "starboard";
  readonly event: ScoreAnimationEvent | undefined;
}): ReactNode {
  const [effect, setEffect] = useState<ScoreAnimationEvent | null>(null);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    if (event === undefined) {
      return;
    }
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
    }
    setEffect(event);
    clearTimer.current = window.setTimeout(() => {
      setEffect((current) =>
        current?.sequence === event.sequence ? null : current,
      );
      clearTimer.current = null;
    }, 620);
  }, [event]);

  useEffect(
    () => () => {
      if (clearTimer.current !== null) {
        window.clearTimeout(clearTimer.current);
      }
    },
    [],
  );

  return (
    <div
      key={event?.sequence ?? "idle"}
      className={`score score--${side} ${effect === null ? "" : "score--changed"}`}
    >
      {effect === null ? null : (
        <span className="score__effects" key={effect.sequence} aria-hidden="true">
          <span className="score__ring" />
          <span className="score__old">{effect.previousScore}</span>
          <span className="score__particle score__particle--one" />
          <span className="score__particle score__particle--two" />
        </span>
      )}
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function Chip({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}): ReactNode {
  return (
    <span className="chip">
      <b>{label}</b>
      {children}
    </span>
  );
}

function PlayerPlate({
  player,
  side,
  scoreEvent,
}: {
  readonly player: OverlayPlayer | null;
  readonly side: "port" | "starboard";
  readonly scoreEvent: ScoreAnimationEvent | undefined;
}): ReactNode {
  const flag = countryFlagEmoji(player?.country ?? null);
  const chips: ReactNode[] = [
    player?.seed === null || player?.seed === undefined ? null : (
      <Chip key="seed" label="Seed">
        {player.seed}
      </Chip>
    ),
    player?.social === null || player?.social === undefined ? null : (
      <Chip key="social" label="@">
        {player.social.replace(/^@/, "")}
      </Chip>
    ),
    player?.pronouns === null || player?.pronouns === undefined ? null : (
      <Chip key="pronouns" label="Pronouns">
        {player.pronouns}
      </Chip>
    ),
    player === null || (player.location === null && flag === null) ? null : (
      <Chip key="location" label="From">
        {flag === null ? null : (
          <span
            className="chip__flag"
            role="img"
            aria-label={`${player.country ?? "Country"} flag`}
          >
            {flag}
          </span>
        )}
        {player.location ?? null}
      </Chip>
    ),
  ];

  return (
    <section className={`player player--${side}`}>
      <div className="player__plate">
        <div className="player__name">
          {player?.prefix === null || player?.prefix === undefined ? null : (
            <span>{player.prefix}</span>
          )}
          <strong>{player?.displayName ?? "TBD"}</strong>
        </div>
        <Score
          value={player?.score ?? null}
          side={side}
          event={scoreEvent}
        />
      </div>
      <div className="chips">{chips}</div>
    </section>
  );
}

function Helm({
  turn,
  duration,
  easing,
  pulse,
}: {
  readonly turn: number;
  readonly duration: number;
  readonly easing: string;
  readonly pulse: {
    readonly side: "port" | "starboard";
    readonly sequence: number;
  } | null;
}): ReactNode {
  const style = {
    "--helm-turn": `${String(turn)}deg`,
    "--helm-duration": `${String(duration)}ms`,
    "--helm-easing": easing,
  } as CSSProperties;
  return (
    <div className="helm-rig">
      <div className="helm" style={style}>
        {Array.from({ length: 8 }, (_, index) => (
          <i
            className={`helm__bolt ${
              pulse !== null &&
              ((pulse.side === "port" && index === 6) ||
                (pulse.side === "starboard" && index === 2))
                ? "helm__bolt--pulse"
                : ""
            }`}
            style={{ "--i": index } as CSSProperties}
            key={`${String(index)}-${pulse?.sequence ?? "idle"}`}
          />
        ))}
        <div className="helm__logo" />
      </div>
    </div>
  );
}

function MatchPlate({ view }: { readonly view: OverlayView }): ReactNode {
  const suckerPositions = [
    [42, 40],
    [57, 47],
    [75, 46],
    [95, 37],
    [114, 27],
    [134, 25],
  ] as const;

  return (
    <>
      <div className="match-plate">
        <svg viewBox="0 0 64 72" aria-hidden="true">
          <circle cx="32" cy="10" r="7" />
          <path d="M32 17v38M18 29h28M12 43c2 15 10 22 20 22s18-7 20-22M12 43l-7 9M12 43l10 2M52 43l7 9M52 43l-10 2" />
        </svg>
        <strong>{view.roundName || "Waiting for set"}</strong>
        <span>{view.phaseName || "Operator dashboard"}</span>
      </div>
      <svg
        className="tentacle"
        viewBox="0 0 194 66"
        fill="none"
        aria-hidden="true"
      >
        <path className="tentacle__outline" d="M34 2C18 19 26 43 58 47C92 51 104 24 130 24C158 24 171 49 150 56" />
        <path className="tentacle__fill" d="M34 2C18 19 26 43 58 47C92 51 104 24 130 24C158 24 171 49 150 56" />
        <g>
          {suckerPositions.map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="2.5" />
          ))}
        </g>
      </svg>
    </>
  );
}

function Scoreboard({
  view,
  connected,
  animationEvents,
}: {
  readonly view: OverlayView;
  readonly connected: boolean;
  readonly animationEvents: readonly OverlayAnimationEvent[];
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const entranceAnimations = useRef<Animation[]>([]);
  const entranceFrame = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const [wheel, setWheel] = useState({
    turn: 0,
    duration: 2_400,
    easing: WHEEL_EASE,
  });
  const [pulse, setPulse] = useState<{
    readonly side: "port" | "starboard";
    readonly sequence: number;
  } | null>(null);

  useEffect(() => {
    entranceFrame.current = window.requestAnimationFrame(() => {
      if (rootRef.current === null) {
        return;
      }
      entranceAnimations.current = runSetEntrance(rootRef.current, true);
      if (!reducedMotion()) {
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
      for (const animation of entranceAnimations.current) {
        animation.cancel();
      }
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
        for (const animation of entranceAnimations.current) {
          animation.cancel();
        }
        entranceAnimations.current = runSetEntrance(rootRef.current, false);
      });
      if (!reducedMotion()) {
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
      if (!reducedMotion()) {
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

  return (
    <div className="scoreboard" ref={rootRef}>
      <MatchPlate view={view} />
      <PlayerPlate
        player={view.players[0]}
        side="port"
        scoreEvent={portScoreEvent}
      />
      <PlayerPlate
        player={view.players[1]}
        side="starboard"
        scoreEvent={starboardScoreEvent}
      />
      <Helm
        turn={wheel.turn}
        duration={wheel.duration}
        easing={wheel.easing}
        pulse={pulse}
      />
      <div className="event-plate">
        <span>{view.tournamentName || "Tournament Overlay"}</span>
        <i aria-hidden="true" />
        <strong>{view.eventName || "No event loaded"}</strong>
      </div>
      {(!connected || view.status === "stale" || view.status === "error") && (
        <div className="freshness">
          <span />
          {!connected ? "Server reconnecting" : "Tournament data stale"}
        </div>
      )}
    </div>
  );
}

export default function OctagonOverlay({
  view,
  connected,
  animationEvents,
}: OverlayTemplateProps): ReactNode {
  return (
    <div className="octagon-template">
      <Scoreboard
        view={view}
        connected={connected}
        animationEvents={animationEvents}
      />
    </div>
  );
}
