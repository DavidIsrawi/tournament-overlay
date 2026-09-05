import {
  findSet,
  deriveOverlayView,
  type ClientCommand,
  type OverlayView,
  type ServerState,
} from "../../shared/contracts.ts";
import { OVERLAY_TEMPLATES } from "../../shared/overlay-templates.ts";
import { formatTime, overlayUrl } from "../helpers.ts";
import type { PendingCommand } from "../../shared/command-tracker.ts";
import {
  useState,
  type ReactNode,
} from "react";

function ScenePlayers({
  players,
  label,
}: {
  readonly players: OverlayView["players"];
  readonly label: string;
}): ReactNode {
  return (
    <div className="scene__players" aria-label={label}>
      {players.map((player, index) => (
        <div
          className={`scene-player scene-player--${index + 1} ${player?.prefix?.trim() ? "" : "scene-player--no-prefix"}`}
          key={index}
        >
          <span>{player?.prefix?.trim() || null}</span>
          <strong title={player?.displayName}>{player?.displayName ?? "TBD"}</strong>
          <b>{player?.score ?? "—"}</b>
        </div>
      ))}
    </div>
  );
}

export function SceneRail({
  state,
  send,
  connected,
  pendingCommands,
}: {
  readonly state: ServerState;
  readonly send: (command: ClientCommand) => boolean;
  readonly connected: boolean;
  readonly pendingCommands: readonly PendingCommand[];
}): ReactNode {
  const selectedSet = findSet(state.event, state.operator.selectedSetId);
  const preview = deriveOverlayView(
    state.revision, state.event, selectedSet, state.operator.presentation, state.connection.status,
  );
  const alreadyLive = state.operator.liveSelection?.providerId === state.event?.providerId &&
    state.operator.liveSelection?.eventInput === state.event?.slug &&
    state.overlay.setId === selectedSet?.id;
  const pending = (type: ClientCommand["type"]): boolean =>
    pendingCommands.some((command) => command.type === type);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const url = overlayUrl();
  const activeTemplate =
    OVERLAY_TEMPLATES.find(
      (template) =>
        template.id === state.operator.presentation.overlayTemplateId,
    ) ?? OVERLAY_TEMPLATES[0];

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Overlay URL copied.");
    } catch (error) {
      setCopyStatus(
        error instanceof Error
          ? `Could not copy: ${error.message}`
          : "Could not copy the overlay URL.",
      );
    }
  };

  return (
    <aside className="scene">
      <section className="scene-preview" aria-labelledby="preview-title">
        <div className="scene__heading">
          <div>
            <h2 id="preview-title">Preview</h2>
            <p>{selectedSet?.round.name ?? "Select a set in the bracket"}</p>
          </div>
          <span className="scene__live">{alreadyLive ? "On air" : "Not on air"}</span>
        </div>
        <p>{preview.tournamentName}{preview.eventName ? ` / ${preview.eventName}` : ""}</p>
        <ScenePlayers players={preview.players} label="Preview players" />
        <button
          className="button button--load"
          type="button"
          disabled={!connected || selectedSet === null || alreadyLive || pending("live.take")}
          onClick={() => {
            if (state.event !== null && selectedSet !== null) {
              send({ type: "live.take", eventId: state.event.id, setId: selectedSet.id });
            }
          }}
        >
          {pending("live.take") ? "Taking live…" : alreadyLive ? "Already live" : "Take live"}
        </button>
        <p>Loads the latest set data before replacing the broadcast.</p>
      </section>

      <div className="scene__heading">
        <div>
          <h2>Live scene</h2>
          <p>{state.overlay.roundName || "No set on air"}</p>
        </div>
        <span className={`scene__live scene__live--${state.overlay.status}`}>
          {connected ? state.overlay.status : "disconnected"}
        </span>
      </div>
      <p>{state.overlay.tournamentName}{state.overlay.eventName ? ` / ${state.overlay.eventName}` : ""}</p>
      <p className="scene__freshness" role="status">
        {connected ? `Live data ${state.liveConnection.status}` : "Server disconnected"}
        {" · Updated "}{formatTime(state.liveConnection.lastUpdatedAt)}
        {state.liveConnection.message === null ? "" : ` · ${state.liveConnection.message}`}
        {state.liveConnection.nextPollAt === null ? "" : ` · Next update ${formatTime(state.liveConnection.nextPollAt)}`}
      </p>

      <ScenePlayers players={state.overlay.players} label="Overlay side order" />

      <div className="scene__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={!connected || state.overlay.setId === null || pending("presentation.swap")}
          onClick={() => send({ type: "presentation.swap" })}
        >
          <span aria-hidden="true">⇄</span> Swap live player sides
        </button>
      </div>

      <fieldset className="overlay-picker">
        <legend>Overlay design</legend>
        <div>
          {OVERLAY_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.id}
              disabled={!connected || pending("overlay.select")}
              aria-pressed={template.id === activeTemplate.id}
              onClick={() =>
                send({
                  type: "overlay.select",
                  templateId: template.id,
                })
              }
            >
              {template.name}
            </button>
          ))}
        </div>
        <p>{activeTemplate.description}</p>
      </fieldset>

      <section className="overlay-link">
        <h3>OBS browser source</h3>
        <p>
          {activeTemplate.name} · 1920 × 1080 · transparent background
        </p>
        <code>{url}</code>
        <div>
          <button
            className="button button--small"
            type="button"
            onClick={() => {
              void copy();
            }}
          >
            Copy URL
          </button>
          <a
            className="button button--small button--quiet"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Open overlay
          </a>
        </div>
        <output aria-live="polite">{copyStatus}</output>
      </section>

      <dl className="scene__facts">
        <div>
          <dt>Provider</dt>
          <dd>
            {state.providers.find(
              (provider) => provider.id === state.operator.liveSelection?.providerId,
            )?.name ?? "No live provider"}
          </dd>
        </div>
      </dl>
    </aside>
  );
}
