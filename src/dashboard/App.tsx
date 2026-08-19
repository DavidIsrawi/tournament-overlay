import { useTournamentSocket } from "../shared/browser-client.ts";
import {
  findSet,
  type ClientCommand,
  type NormalizedSet,
  type ServerState,
} from "../shared/contracts.ts";
import {
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type SetFilter = "pending" | "completed";

function formatTime(value: string | null): string {
  if (value === null) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function overlayUrl(): string {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:5174/overlay/octagon/`;
  }
  return new URL("/overlay/octagon/", window.location.origin).toString();
}

function entrantLabel(set: NormalizedSet): string {
  const [left, right] = set.entrants;
  return `${left?.entrant.name ?? "TBD"} vs ${right?.entrant.name ?? "TBD"}`;
}

function StatusDot({
  tone,
}: {
  readonly tone: "good" | "warn" | "bad" | "muted";
}): ReactNode {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}

function providerTone(
  state: ServerState,
): "good" | "warn" | "bad" | "muted" {
  switch (state.connection.status) {
    case "fresh":
      return "good";
    case "loading":
    case "stale":
      return "warn";
    case "error":
      return "bad";
    case "idle":
      return "muted";
  }
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
            <span>{index === 0 ? "Port" : "Starboard"}</span>
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

      <section className="overlay-link">
        <h3>OBS browser source</h3>
        <p>1920 × 1080 · transparent background</p>
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

  const selectedProvider = state.providers.find(
    (provider) => provider.id === providerId,
  );

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
          <button className="button button--load" type="submit">
            Load event
          </button>
        </form>

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
                : "Showing last known tournament data"}
            </strong>
            <small>{state.connection.message ?? error}</small>
          </span>
          <button
            className="button button--small"
            type="button"
            onClick={() => sendCommand({ type: "refresh" })}
          >
            Try again
          </button>
        </div>
      )}

      {!selectedProvider?.configured && providerId === "startgg" && (
        <div className="token-hint">
          StartGG needs a server-side token. Add <code>STARTGG_API_TOKEN</code>{" "}
          to <code>.env</code> and restart; the token is never sent here.
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
              <small>{group.sets.length}</small>
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
