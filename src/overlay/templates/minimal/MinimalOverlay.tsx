import type { OverlayPlayer } from "../../../shared/contracts.ts";
import type { ReactNode } from "react";
import type { OverlayTemplateProps } from "../../types.ts";
import "./styles.css";

function Player({
  player,
  side,
}: {
  readonly player: OverlayPlayer | null;
  readonly side: "port" | "starboard";
}): ReactNode {
  return (
    <section className={`minimal-player minimal-player-${side}`}>
      <div className="minimal-player-identity">
        <span>{player?.prefix ?? (side === "port" ? "Player one" : "Player two")}</span>
        <strong>{player?.displayName ?? "TBD"}</strong>
      </div>
      <div className="minimal-player-score" aria-label="Score">
        {player?.score ?? "—"}
      </div>
    </section>
  );
}

export default function MinimalOverlay({
  view,
  connected,
}: OverlayTemplateProps): ReactNode {
  const freshnessVisible =
    !connected || view.status === "stale" || view.status === "error";

  return (
    <div className="minimal-template" key={view.setId ?? "empty"}>
      <div className="minimal-event">
        <span>{view.tournamentName || "Tournament Overlay"}</span>
        <strong>{view.eventName || "No event loaded"}</strong>
      </div>

      <div className="minimal-scoreboard">
        <Player player={view.players[0]} side="port" />
        <div className="minimal-match">
          <strong>{view.roundName || "Waiting for set"}</strong>
          <span>{view.phaseName || "Operator dashboard"}</span>
        </div>
        <Player player={view.players[1]} side="starboard" />
      </div>

      {freshnessVisible && (
        <div className="minimal-freshness">
          <span aria-hidden="true" />
          {!connected ? "Server reconnecting" : "Tournament data stale"}
        </div>
      )}
    </div>
  );
}
