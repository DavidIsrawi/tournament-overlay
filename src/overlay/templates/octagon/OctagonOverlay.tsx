import type {
  OverlayPlayer,
  OverlayView,
} from "../../../shared/contracts.ts";
import { countryFlagEmoji } from "../../../shared/country-flags.ts";
import type {
  OverlayAnimationEvent,
  OverlaySide,
  ScoreAnimationEvent,
} from "../../../shared/overlay-events.ts";
import { overlayFreshnessLabel } from "../../helpers.ts";
import type { OverlayTemplateProps } from "../../types.ts";
import {
  useScoreboardAnimations,
  type ScorePulse,
} from "./useScoreboardAnimations.ts";
import octagonLogo from "./octagon-logo.png";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./styles.css";

const SUCKER_POSITIONS = [
  [42, 40],
  [57, 47],
  [75, 46],
  [95, 37],
  [114, 27],
  [134, 25],
] as const;

function Score({
  value,
  side,
  event,
}: {
  readonly value: number | null;
  readonly side: OverlaySide;
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
      className={`score score-${side} ${effect === null ? "" : "score-changed"}`}
    >
      {effect === null ? null : (
        <span className="score-effects" key={effect.sequence} aria-hidden="true">
          <span className="score-ring" />
          <span className="score-old">{effect.previousScore}</span>
          <span className="score-particle score-particle-one" />
          <span className="score-particle score-particle-two" />
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
  readonly side: OverlaySide;
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
            className="chip-flag"
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
    <section className={`player player-${side}`}>
      <div className="player-plate">
        <div className="player-name">
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
  readonly pulse: ScorePulse | null;
}): ReactNode {
  const style = {
    "--helm-turn": `${String(turn)}deg`,
    "--helm-duration": `${String(duration)}ms`,
    "--helm-easing": easing,
  } as CSSProperties;

  return (
    <div className="helm-rig">
      <svg
        className="helm"
        viewBox="0 0 140 140"
        style={style}
        aria-hidden="true"
      >
        <g className="helm-wheel">
          <circle className="helm-ring-outer" cx="70" cy="70" r="79" />
          <circle className="helm-ring-sand" cx="70" cy="70" r="75" />
          <circle className="helm-ring-brass" cx="70" cy="70" r="70" />
          <circle className="helm-ring-deep" cx="70" cy="70" r="63" />
          <circle className="helm-ring-inner" cx="70" cy="70" r="59" />
          {Array.from({ length: 8 }, (_, index) => (
            <rect
              className={`helm-bolt ${
                pulse !== null &&
                ((pulse.side === "port" && index === 6) ||
                  (pulse.side === "starboard" && index === 2))
                  ? "helm-bolt-pulse"
                  : ""
              }`}
              x="64.5"
              y="-9"
              width="11"
              height="18"
              rx="3"
              transform={`rotate(${String(index * 45)} 70 70)`}
              key={`${String(index)}-${pulse?.sequence ?? "idle"}`}
            />
          ))}
        </g>
        <image
          className="helm-logo"
          href={octagonLogo}
          x="21"
          y="21"
          width="98"
          height="98"
          preserveAspectRatio="xMidYMid meet"
        />
      </svg>
    </div>
  );
}

function MatchPlate({ view }: { readonly view: OverlayView }): ReactNode {
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
        <path className="tentacle-outline" d="M34 2C18 19 26 43 58 47C92 51 104 24 130 24C158 24 171 49 150 56" />
        <path className="tentacle-fill" d="M34 2C18 19 26 43 58 47C92 51 104 24 130 24C158 24 171 49 150 56" />
        <g>
          {SUCKER_POSITIONS.map(([x, y]) => (
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
  const {
    portScoreEvent,
    pulse,
    rootRef,
    starboardScoreEvent,
    wheel,
  } = useScoreboardAnimations(animationEvents);
  const freshness = overlayFreshnessLabel(connected, view.status);

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
      {freshness !== null && (
        <div className="freshness">
          <span />
          {freshness}
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
