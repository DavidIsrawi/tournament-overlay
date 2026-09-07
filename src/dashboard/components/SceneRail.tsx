import {
  findSet,
  deriveOverlayView,
  type ClientCommand,
  type OverlayView,
  type ServerState,
} from "../../shared/contracts.ts";
import { OVERLAY_TEMPLATES } from "../../shared/overlay-templates.ts";
import {
  OVERLAY_METADATA_FIELDS,
  OVERLAY_METADATA_LABELS,
} from "../../shared/overlay-metadata.ts";
import { formatTime, overlayUrl } from "../helpers.ts";
import type { PendingCommand } from "../../shared/command-tracker.ts";
import {
  useEffect,
  useRef,
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
          className={`scene-player scene-player--${index + 1}`}
          key={index}
        >
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
  error,
  dismissError,
}: {
  readonly state: ServerState;
  readonly send: (command: ClientCommand) => boolean;
  readonly connected: boolean;
  readonly pendingCommands: readonly PendingCommand[];
  readonly error: string | null;
  readonly dismissError: () => void;
}): ReactNode {
  const selectedSet = findSet(state.event, state.operator.selectedSetId);
  const preview = deriveOverlayView(
    state.revision, state.event, selectedSet, state.operator.presentation, state.connection.status,
  );
  const alreadyLive = selectedSet !== null && state.operator.liveSelection?.providerId === state.event?.providerId &&
    state.operator.liveSelection?.eventInput === state.event?.slug &&
    state.overlay.setId === selectedSet?.id;
  const pending = (type: ClientCommand["type"]): boolean =>
    pendingCommands.some((command) => command.type === type);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const deskRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const desk = deskRef.current;
    if (desk === null) return;
    const update = (): void => {
      document.documentElement.style.setProperty("--broadcast-desk-height", `${desk.offsetHeight}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(desk);
    update();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--broadcast-desk-height");
    };
  }, []);
  const hasLive = state.overlay.setId !== null;
  const visible = state.operator.presentation.overlayVisible;
  const switching = pending("live.take") || pending("live.restore");
  const liveLabel = !visible ? "Hidden" : !hasLive ? "No set" :
    !connected ? "Disconnected" : state.overlay.status === "ready" ? "On air" : "Stale";
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
    <aside className="scene" aria-label="Broadcast controls" ref={deskRef}>
      {error !== null && (
        <div className="notice notice--error" role="alert">
          <span><strong>Action needs attention</strong><small>{error}</small></span>
          <button className="button button--small" type="button" onClick={dismissError}>Dismiss</button>
        </div>
      )}
      <div className="scene__desk">
      <section className="scene-live" aria-labelledby="live-title">
        <div className="scene__heading">
          <h2 id="live-title">Live output</h2>
          <span className={`scene__live scene__live--${visible && connected ? state.overlay.status : "stale"}`}>
            {liveLabel}
          </span>
        </div>
        <p className="scene__context" title={`${state.overlay.roundName} · ${state.overlay.tournamentName} / ${state.overlay.eventName}`}>
          {state.overlay.roundName || "No set selected"}
          {state.overlay.eventName ? ` · ${state.overlay.eventName}` : ""}
        </p>
        <ScenePlayers players={state.overlay.players} label="Live player sides" />
        <button
          className="button button--quiet"
          type="button"
          aria-describedby="live-action-note"
          disabled={!connected || pending("overlay.visibility") || (!hasLive && !switching)}
          onClick={() => send({ type: "overlay.visibility", visible: switching ? false : !visible })}
        >
          {pending("overlay.visibility") ? "Updating output…" :
            switching && !visible ? "Cancel transition" : visible ? "Hide overlay" : "Show overlay"}
        </button>
        <p className="scene__freshness" role="status">
          {connected ? `Live data ${state.liveConnection.status}` : "Server disconnected"}
          {" · "}{state.liveConnection.lastUpdatedAt === null ? "Not updated yet" : formatTime(state.liveConnection.lastUpdatedAt)}
        </p>
      </section>

      <section className="scene-preview" aria-labelledby="preview-title">
        <div className="scene__heading">
          <h2 id="preview-title">Next set</h2>
          <span className="scene__live">{alreadyLive ? "Same set" : "Preview"}</span>
        </div>
        <p className="scene__context" title={`${preview.roundName} · ${preview.tournamentName} / ${preview.eventName}`}>
          {selectedSet?.round.name ?? "Select a set below"}
          {preview.eventName ? ` · ${preview.eventName}` : ""}
        </p>
        <ScenePlayers players={preview.players} label="Preview players" />
        <button
          className="button button--load"
          type="button"
          disabled={!connected || selectedSet === null || (alreadyLive && visible) || switching || pending("overlay.visibility")}
          onClick={() => {
            if (state.event !== null && selectedSet !== null) {
              send({ type: "live.take", eventId: state.event.id, setId: selectedSet.id });
            }
          }}
        >
          {pending("live.take") ? "Taking live…" : alreadyLive && visible ? "Already live" : "Take live"}
        </button>
        <p className="scene__freshness">Fetches fresh scores, then goes on air.</p>
      </section>
      </div>

      {state.liveConnection.message !== null && (
        <p className="scene__warning" role="status">{state.liveConnection.message}</p>
      )}
      <details className="scene-settings">
        <summary>Live controls &amp; setup <span>Applies live</span></summary>
        <div className="scene-settings__body">
        <section className="scene__actions" aria-label="Immediate live actions">
          <h3>Live actions</h3>
          <p id="live-action-note">These controls apply immediately, not to Preview. Hidden output keeps receiving score updates.</p>
          <button
            className="button"
            type="button"
            disabled={!connected || !hasLive || switching || pending("presentation.swap")}
            onClick={() => send({ type: "presentation.swap" })}
          >
            Swap live player sides
          </button>
          <button
            className="button button--quiet"
            type="button"
            disabled={!connected || state.operator.previousLiveSelection === null || switching || pending("overlay.visibility")}
            onClick={() => send({ type: "live.restore" })}
          >
            {pending("live.restore") ? "Restoring…" : "Restore previous live set"}
          </button>
          <p>Restore fetches the previous set and shows it on air. A failed fetch leaves the current output unchanged.</p>
        </section>

      <fieldset className="overlay-picker">
        <legend>Overlay design · applies live</legend>
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

      <fieldset className="metadata-picker">
        <legend>Octagon player details · applies live</legend>
        <p id="metadata-help">Choose up to two. Uncheck a detail to choose another. Details that cannot fit are omitted, never clipped.</p>
        <div>
          {OVERLAY_METADATA_FIELDS.map((field) => {
            const selected = state.operator.presentation.metadataFields.includes(field);
            return (
              <label key={field}>
                <input
                  type="checkbox"
                  checked={selected}
                  aria-describedby="metadata-help"
                  disabled={!connected || pending("presentation.metadata") ||
                    (!selected && state.operator.presentation.metadataFields.length >= 2)}
                  onChange={() => send({
                    type: "presentation.metadata",
                    fields: selected
                      ? state.operator.presentation.metadataFields.filter((value) => value !== field)
                      : [...state.operator.presentation.metadataFields, field],
                  })}
                />
                {OVERLAY_METADATA_LABELS[field]}
              </label>
            );
          })}
        </div>
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
        </div>
      </details>
    </aside>
  );
}
