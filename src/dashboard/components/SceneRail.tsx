import {
  findSet,
  type ClientCommand,
  type ServerState,
} from "../../shared/contracts.ts";
import { OVERLAY_TEMPLATES } from "../../shared/overlay-templates.ts";
import { overlayUrl } from "../helpers.ts";
import {
  useState,
  type ReactNode,
} from "react";

export function SceneRail({
  state,
  send,
}: {
  readonly state: ServerState;
  readonly send: (command: ClientCommand) => boolean;
}): ReactNode {
  const selectedSet = findSet(state.event, state.operator.selectedSetId);
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
      <div className="scene__heading">
        <div>
          <h2>Live scene</h2>
          <p>{selectedSet?.round.name ?? "No set selected"}</p>
        </div>
        <span className={`scene__live scene__live--${state.overlay.status}`}>
          {state.overlay.status}
        </span>
      </div>

      <div className="scene__players" aria-label="Overlay side order">
        {state.overlay.players.map((player, index) => (
          <div className={`scene-player scene-player--${index + 1}`} key={index}>
            <span>{player?.prefix?.trim() || null}</span>
            <strong>{player?.displayName ?? "TBD"}</strong>
            <b>{player?.score ?? "—"}</b>
          </div>
        ))}
      </div>

      <div className="scene__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={selectedSet === null}
          onClick={() => send({ type: "presentation.swap" })}
        >
          <span aria-hidden="true">⇄</span> Swap player sides
        </button>
      </div>

      <fieldset className="overlay-picker">
        <legend>Overlay design</legend>
        <div>
          {OVERLAY_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.id}
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
              (provider) => provider.id === state.operator.providerId,
            )?.name ?? state.operator.providerId}
          </dd>
        </div>
      </dl>
    </aside>
  );
}
