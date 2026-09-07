import { useTournamentSocket } from "../shared/browser-client.ts";
import { BracketWorkspace } from "./components/BracketWorkspace.tsx";
import { SceneRail } from "./components/SceneRail.tsx";
import { TokenSetup } from "./components/TokenSetup.tsx";
import { AboutUpdates } from "./components/AboutUpdates.tsx";
import {
  connectionNotice,
  formatTime,
  type StatusTone,
} from "./helpers.ts";
import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type ReactNode,
} from "react";

function StatusDot({ tone }: { readonly tone: StatusTone }): ReactNode {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

export function App(): ReactNode {
  const { state, socketStatus, error, sendCommand, pendingCommands, dismissError, upgradeRequired } =
    useTournamentSocket("dashboard");
  const [providerInput, setProviderId] = useState<string | null>(null);
  const [eventDraft, setEventInput] = useState<string | null>(null);
  const [showTokenSetup, setShowTokenSetup] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showEventSetup, setShowEventSetup] = useState(false);
  useEffect(() => {
    if (state?.event?.id !== undefined) {
      setShowEventSetup(false);
    }
  }, [state?.event?.id]);
  const aboutButton = useRef<HTMLButtonElement>(null);
  const closeAbout = (): void => {
    setShowAbout(false);
    aboutButton.current?.focus();
  };
  const providerId = providerInput ?? state?.operator.providerId ?? "startgg";
  const eventInput = eventDraft ?? state?.operator.eventInput ?? "";
  const connected = socketStatus === "connected";
  const pending = (type: string): boolean => pendingCommands.some((command) => command.type === type);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    sendCommand({ type: "event.load", providerId, input: eventInput });
  };

  if (state === null || upgradeRequired) {
    return (
      <div className="boot-screen">
        <div className="mini-helm" aria-hidden="true">
          TO
        </div>
        <h1>{upgradeRequired ? "Application updated" : "Connecting to tournament server"}</h1>
        <p>{error ?? "Waiting for the first synchronized state snapshot…"}</p>
        {upgradeRequired && (
          <>
            <p>After reloading the dashboard, refresh the OBS browser source as well.</p>
            <button className="button button--load" type="button" onClick={() => window.location.reload()}>
              Reload dashboard
            </button>
          </>
        )}
      </div>
    );
  }

  const startGgProvider = state.providers.find(
    (provider) => provider.id === "startgg",
  );

  if (!startGgProvider?.configured || showTokenSetup) {
    if (showAbout) {
      return <div className="setup-screen"><AboutUpdates onClose={closeAbout} /></div>;
    }
    return (
      <TokenSetup
        canCancel={startGgProvider?.configured === true}
        onCancel={() => setShowTokenSetup(false)}
        onSaved={() => setShowTokenSetup(false)}
        onAbout={() => setShowAbout(true)}
      />
    );
  }

  const notice = connectionNotice(state.connection, null);

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

        {(state.event === null || showEventSetup) && <form id="event-setup" className="event-loader" onSubmit={submit}>
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
            disabled={!connected || pending("event.load")}
          >
            {pending("event.load") ? "Loading…" : "Load event"}
          </button>
        </form>}

        <div className="command__status">
          <div className="health" aria-live="polite">
            <StatusDot tone={socketStatus === "connected" ? "good" : "warn"} />
            <span>
              <strong>
                {socketStatus === "connected" ? "Server live" : socketStatus}
              </strong>
              <small>
                {state.connection.status === "fresh"
                  ? `Bracket updated ${formatTime(state.connection.lastUpdatedAt)}`
                  : `Bracket ${state.connection.status}`}
              </small>
            </span>
          </div>
          <button
            className="button button--small button--load"
            type="button"
            aria-expanded={state.event === null || showEventSetup}
            aria-controls="event-setup"
            disabled={state.event === null}
            onClick={() => setShowEventSetup(!showEventSetup)}
          >
            {showEventSetup ? "Close event setup" : "Change event"}
          </button>
          <div className="command__links">
            <button
              className="token-settings"
              type="button"
              onClick={() => setShowTokenSetup(true)}
            >
              API token
            </button>
            <button
              className="token-settings"
              type="button"
              ref={aboutButton}
              aria-expanded={showAbout}
              onClick={() => setShowAbout(!showAbout)}
            >
              About &amp; updates
            </button>
          </div>
        </div>
      </header>

      {showAbout && <AboutUpdates onClose={closeAbout} />}

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
              disabled={!connected || pending("refresh")}
              onClick={() => sendCommand({ type: "refresh" })}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <SceneRail
        state={state}
        send={sendCommand}
        connected={connected}
        pendingCommands={pendingCommands}
        error={error}
        dismissError={dismissError}
      />

      <nav className="phase-tabs" aria-label="Phase groups">
        <span>Phase groups</span>
        <div>
          {(state.event?.phaseGroups ?? []).map((group) => (
            <button
              type="button"
              key={group.id}
              disabled={!connected || (pending("phase.select") && group.id === state.operator.selectedPhaseGroupId)}
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
          disabled={!connected || pending("refresh")}
          onClick={() => sendCommand({ type: "refresh" })}
        >
          {pending("refresh") ? "Refreshing…" : "Refresh data"}
        </button>
      </nav>

      <div className="workspace">
        <BracketWorkspace state={state} send={sendCommand} disabled={!connected || pending("set.select")} />
      </div>
    </div>
  );
}
