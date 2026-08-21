import type {
  ClientCommand,
  NormalizedSet,
  ServerState,
} from "../../shared/contracts.ts";
import {
  buildVisibleRounds,
  type SetFilter,
} from "../helpers.ts";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

function AnchorIcon(): ReactNode {
  return (
    <svg className="anchor" viewBox="0 0 64 72" aria-hidden="true">
      <circle cx="32" cy="10" r="7" />
      <path d="M32 17v38M18 29h28M12 43c2 15 10 22 20 22s18-7 20-22M12 43l-7 9M12 43l10 2M52 43l7 9M52 43l-10 2" />
    </svg>
  );
}

export function BracketWorkspace({
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
  const rounds = useMemo(
    () => buildVisibleRounds(group?.sets ?? [], query, filter),
    [filter, group?.sets, query],
  );
  const visibleSetCount = rounds.reduce(
    (total, round) => total + round.sets.length,
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
          {rounds.map((round) => (
            <section className="round" key={round.name}>
              <header>
                <h2>{round.name}</h2>
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
