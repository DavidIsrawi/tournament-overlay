import { useTournamentSocket } from "../shared/browser-client.ts";
import {
  findSet,
  type ClientCommand,
  type NormalizedSet,
  type ServerState,
} from "../shared/contracts.ts";
import { OVERLAY_TEMPLATES } from "../shared/overlay-templates.ts";
import {
  entrantLabel,
  formatTime,
  overlayUrl,
  providerTone,
} from "./helpers.ts";
import {
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type SetFilter = "pending" | "completed";

function StatusDot({
  tone,
}: {
  readonly tone: "good" | "warn" | "bad" | "muted";
}): ReactNode {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

function TokenSetup({
  canCancel,
  onCancel,
  onSaved,
}: {
  readonly canCancel: boolean;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}): ReactNode {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      setStatus("Enter your StartGG API token.");
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/startgg-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: trimmedToken }),
      });
      if (!response.ok) {
        setStatus(
          response.status === 400
            ? "Enter a valid StartGG API token."
            : "The token could not be saved. Try again.",
        );
        return;
      }
      setToken("");
      setStatus("Token saved locally.");
      onSaved();
    } catch (requestError) {
      setStatus(
        requestError instanceof Error
          ? `The local server could not save the token: ${requestError.message}`
          : "The local server could not save the token.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="setup-screen">
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="setup-panel__identity">
          <div className="mini-helm" aria-hidden="true">
            TO
          </div>
          <div>
            <strong>Tournament Overlay</strong>
            <span>Local broadcast control</span>
          </div>
        </div>
        <div className="setup-panel__content">
          <h1 id="setup-title">Connect StartGG</h1>
          <p>
            Add a personal API token to load tournament brackets and keep your
            OBS overlay synchronized.
          </p>
          <form className="token-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="startgg-token">Personal API token</label>
            <input
              id="startgg-token"
              name="startgg-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder="Paste token"
              onChange={(event) => setToken(event.target.value)}
            />
            <div className="token-form__actions">
              <button
                className="button button--load"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save and continue"}
              </button>
              {canCancel && (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={onCancel}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <p className="setup-panel__privacy">
            The token is remembered in this user account's local configuration
            file with owner-only permissions. It is never included in dashboard
            state or sent to OBS.
          </p>
          <a
            href="https://www.start.gg/admin/profile/developer"
            target="_blank"
            rel="noreferrer"
          >
            Create a token in StartGG Developer Settings
          </a>
          <output className="setup-panel__status" aria-live="polite">
            {status}
          </output>
        </div>
      </section>
    </main>
  );
}

function SetCard({
  set,
  selected,
  onSelect,
}: {
  readonly set: NormalizedSet;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  return (
    <button
      className={`set-card set-card--${set.state}`}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="set-card__topline">
        <span>{set.identifier}</span>
        <span>{set.state}</span>
      </span>
      {set.entrants.map((slot, index) => (
        <span className="set-card__entrant" key={slot?.entrant.id ?? index}>
          <span>
            {slot?.entrant.seed === null || slot?.entrant.seed === undefined
              ? null
              : `${String(slot.entrant.seed)} · `}
            {slot?.entrant.name ?? "TBD"}
          </span>
          <strong>{slot?.score ?? "—"}</strong>
        </span>
      ))}
    </button>
  );
}

function BracketWorkspace({
  state,
  send,
}: {
  readonly state: ServerState;
  readonly send: (command: ClientCommand) => boolean;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SetFilter>("pending");
  const group = state.event?.phaseGroups.find(
    (candidate) => candidate.id === state.operator.selectedPhaseGroupId,
  );
  const rounds = useMemo(() => {
    const matchingSets = (group?.sets ?? []).filter((set) => {
      const matchesQuery =
        query.trim().length === 0 ||
        `${set.identifier} ${set.round.name} ${entrantLabel(set)}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
      const matchesFilter =
        filter === "pending"
          ? set.state === "pending" || set.state === "active"
          : set.state === "completed";
      return matchesQuery && matchesFilter;
    });
    const byRound = new Map<
      string,
      { readonly order: number; readonly sets: NormalizedSet[] }
    >();
    for (const set of matchingSets) {
      const round = byRound.get(set.round.name);
      if (round === undefined) {
        byRound.set(set.round.name, {
          order: set.round.order,
          sets: [set],
        });
      } else {
        round.sets.push(set);
      }
    }
    return [...byRound.entries()].sort(
      ([, left], [, right]) => left.order - right.order,
    );
  }, [filter, group?.sets, query]);
  const visibleSetCount = rounds.reduce(
    (total, [, round]) => total + round.sets.length,
    0,
  );

  return (
    <main className="bracket">
      <div className="bracket__tools">
        <div>
          <h1>{group?.phaseName ?? "Bracket"}</h1>
          <p>
            {group === undefined
              ? "Load an event to browse its phase groups."
              : !group.setsLoaded && state.connection.message !== null
                ? state.connection.message
              : `${visibleSetCount.toString()} visible sets · ${rounds.length.toString()} rounds`}
          </p>
        </div>
        <label className="search-field">
          <span className="sr-only">Search sets</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder="Search player, set, or round"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="filter-field">
          <span>Show</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as SetFilter)}
          >
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>

      {group === undefined ? (
        <div className="empty-state">
          <AnchorIcon />
          <h2>No bracket loaded</h2>
          <p>Enter a StartGG event URL or slug in the controls above.</p>
        </div>
      ) : !group.setsLoaded && rounds.length === 0 ? (
        <div className="empty-state">
          <h2>Loading bracket</h2>
          <p>{state.connection.message ?? "Fetching sets from StartGG…"}</p>
        </div>
      ) : rounds.length === 0 ? (
        <div className="empty-state">
          <h2>No sets match</h2>
          <p>Clear the search or choose the other set-state filter.</p>
        </div>
      ) : (
        <div className="rounds" aria-label={`${group.phaseName} bracket`}>
          {rounds.map(([name, round]) => (
            <section className="round" key={name}>
              <header>
                <h2>{name}</h2>
                <span>{round.sets.length}</span>
              </header>
              <div className="round__sets">
                {round.sets.map((set) => (
                  <SetCard
                    key={set.id}
                    set={set}
                    selected={state.operator.selectedSetId === set.id}
                    onSelect={() => send({ type: "set.select", setId: set.id })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function AnchorIcon(): ReactNode {
  return (
    <svg className="anchor" viewBox="0 0 64 72" aria-hidden="true">
      <circle cx="32" cy="10" r="7" />
      <path d="M32 17v38M18 29h28M12 43c2 15 10 22 20 22s18-7 20-22M12 43l-7 9M12 43l10 2M52 43l7 9M52 43l-10 2" />
    </svg>
  );
}

function SceneRail({
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
            <span>
              {player?.prefix?.trim() || null}
            </span>
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

      {(state.connection.message !== null || error !== null) && (
        <div
          className={`notice notice--${state.connection.status === "error" ? "error" : "warning"}`}
          role="status"
        >
          <StatusDot tone={providerTone(state)} />
          <span>
            <strong>
              {state.connection.status === "error"
                ? "Provider needs attention"
                : state.connection.status === "loading"
                  ? "Loading tournament data"
                  : "Showing last known tournament data"}
            </strong>
            <small>{state.connection.message ?? error}</small>
          </span>
          {state.connection.status !== "loading" && (
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
