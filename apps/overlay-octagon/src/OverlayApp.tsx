import { useTournamentSocket } from "@tournament-overlay/browser-client";
import type {
  OverlayPlayer,
  OverlayView,
} from "@tournament-overlay/contracts";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

function useStageScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = (): void => {
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return scale;
}

function Score({
  value,
  side,
}: {
  readonly value: number | null;
  readonly side: "port" | "starboard";
}): ReactNode {
  const previous = useRef<number | null>(value);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (previous.current !== value) {
      setChanged(false);
      const frame = window.requestAnimationFrame(() => setChanged(true));
      previous.current = value;
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [value]);

  return (
    <div className={`score score--${side} ${changed ? "score--changed" : ""}`}>
      <span className="score__ring" aria-hidden="true" />
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
}: {
  readonly player: OverlayPlayer | null;
  readonly side: "port" | "starboard";
}): ReactNode {
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
    player?.location === null || player?.location === undefined ? null : (
      <Chip key="location" label="From">
        {player.location}
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
        <Score value={player?.score ?? null} side={side} />
      </div>
      <div className="chips">{chips}</div>
    </section>
  );
}

function Helm({ turn }: { readonly turn: number }): ReactNode {
  const style = {
    "--helm-turn": `${String(turn)}deg`,
  } as CSSProperties;
  return (
    <div className="helm-rig">
      <div className="helm" style={style}>
        {Array.from({ length: 8 }, (_, index) => (
          <i
            className="helm__bolt"
            style={{ "--i": index } as CSSProperties}
            key={index}
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
}: {
  readonly view: OverlayView;
  readonly connected: boolean;
}): ReactNode {
  const [turn, setTurn] = useState(0);
  const previousScores = useRef(
    view.players.map((player) => player?.score ?? null),
  );

  useEffect(() => {
    const scores = view.players.map((player) => player?.score ?? null);
    if (scores[0] !== previousScores.current[0]) {
      setTurn((current) => current - 45);
    } else if (scores[1] !== previousScores.current[1]) {
      setTurn((current) => current + 45);
    }
    previousScores.current = scores;
  }, [view.players]);

  return (
    <div className="scoreboard" key={view.setId ?? "empty"}>
      <MatchPlate view={view} />
      <PlayerPlate player={view.players[0]} side="port" />
      <PlayerPlate player={view.players[1]} side="starboard" />
      <Helm turn={turn} />
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

export function OverlayApp(): ReactNode {
  const { state, socketStatus } = useTournamentSocket("overlay");
  const scale = useStageScale();
  const style = {
    transform: `scale(${String(scale)})`,
  };

  if (state === null) {
    return (
      <div className="stage" style={style}>
        <div className="overlay-empty">Connecting to tournament server…</div>
      </div>
    );
  }

  return (
    <div className="stage" style={style}>
      <Scoreboard
        view={state.overlay}
        connected={socketStatus === "connected"}
      />
    </div>
  );
}
