import { useTournamentSocket } from "../shared/browser-client.ts";
import { BracketWorkspace } from "./components/BracketWorkspace.tsx";
import { SceneRail } from "./components/SceneRail.tsx";
import { TokenSetup } from "./components/TokenSetup.tsx";
import {
  connectionNotice,
  formatTime,
  type StatusTone,
} from "./helpers.ts";
import {
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

function StatusDot({ tone }: { readonly tone: StatusTone }): ReactNode {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

export function App(): ReactNode {
  const { state, socketStatus, error, sendCommand } =
    useTournamentSocket("dashboard");
  const [providerId, setProviderId] = useState("startgg");
  const [eventInput, setEventInput] = useState("");
  const [showTokenSetup, setShowTokenSetup] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    sendCommand({ type: "event.load", providerId, input: eventInput });
  };

  if (state === null) {
    return (
      <div className="boot-screen">
        <div className="mini-helm" aria-hidden="true">
          TO
        </div>
        <h1>Connecting to tournament server</h1>
        <p>{error ?? "Waiting for the first synchronized state snapshot…"}</p>
      </div>
    );
  }

  const startGgProvider = state.providers.find(
    (provider) => provider.id === "startgg",
  );

  if (!startGgProvider?.configured || showTokenSetup) {
    return (
      <TokenSetup
        canCancel={startGgProvider?.configured === true}
        onCancel={() => setShowTokenSetup(false)}
        onSaved={() => setShowTokenSetup(false)}
      />
    );
  }

  const notice = connectionNotice(state.connection, error);

  return (
    <div className="app-shell">
      <header className="command">
        <a className="brand" href="/" aria-label="Tournament Overlay home">
          <span className="brand__mark">TO</span>
          <span>
            <strong>Tournament Overlay</strong>
            <small>Local broadcast control</small>
          </span>
        </a>

        <form className="event-loader" onSubmit={submit}>
          <label>
            <span>Provider</span>
            <select
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {state.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                  {provider.configured ? "" : " · token required"}
                </option>
              ))}
            </select>
          </label>
          <label className="event-loader__input">
            <span>Event URL or slug</span>
            <input
              required
              value={eventInput}
              placeholder="https://www.start.gg/tournament/…/event/…"
              onChange={(event) => setEventInput(event.target.value)}
            />
          </label>
          <button
            className="button button--load"
            type="submit"
            disabled={state.connection.status === "loading"}
          >
            {state.connection.status === "loading" ? "Loading…" : "Load event"}
          </button>
        </form>

        <div className="command__status">
          <div className="health" aria-live="polite">
            <StatusDot tone={socketStatus === "connected" ? "good" : "warn"} />
            <span>
              <strong>
                {socketStatus === "connected" ? "Server live" : socketStatus}
              </strong>
              <small>
                {state.connection.status === "fresh"
                  ? `Fresh at ${formatTime(state.connection.lastUpdatedAt)}`
                  : state.connection.status}
              </small>
            </span>
          </div>
          <button
            className="token-settings"
            type="button"
            onClick={() => setShowTokenSetup(true)}
          >
            API token
          </button>
        </div>
      </header>

      {notice !== null && (
        <div className={`notice notice--${notice.variant}`} role="status">
          <StatusDot tone={notice.tone} />
          <span>
            <strong>{notice.title}</strong>
            <small>{notice.message}</small>
          </span>
          {notice.canRetry && (
            <button
              className="button button--small"
              type="button"
              onClick={() => sendCommand({ type: "refresh" })}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <nav className="phase-tabs" aria-label="Phase groups">
        <span>Phase groups</span>
        <div>
          {(state.event?.phaseGroups ?? []).map((group) => (
            <button
              type="button"
              key={group.id}
              aria-current={
                group.id === state.operator.selectedPhaseGroupId
                  ? "page"
                  : undefined
              }
              onClick={() =>
                sendCommand({
                  type: "phase.select",
                  phaseGroupId: group.id,
                })
              }
            >
              {group.name}
              <small>{group.setsLoaded ? group.sets.length : "…"}</small>
            </button>
          ))}
        </div>
        <button
          className="button button--refresh"
          type="button"
          disabled={state.connection.status === "loading"}
          onClick={() => sendCommand({ type: "refresh" })}
        >
          {state.connection.status === "loading" ? "Loading…" : "Refresh data"}
        </button>
      </nav>

      <div className="workspace">
        <BracketWorkspace state={state} send={sendCommand} />
        <SceneRail state={state} send={sendCommand} />
      </div>
    </div>
  );
}
