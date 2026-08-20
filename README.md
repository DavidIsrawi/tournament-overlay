# Tournament Overlay

A local, read-only tournament operator dashboard and OBS browser-source overlay. One Node server owns provider access, polling, presentation state, persistence, and live updates; browser clients never contact StartGG.

## Quick start

Requires Node.js 24 LTS and npm 11 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

- Dashboard: <http://127.0.0.1:5173>
- Live overlay: <http://127.0.0.1:5174/overlay/>
- Local server: <http://127.0.0.1:3100>

## StartGG setup

1. Sign in at [start.gg](https://www.start.gg/).
2. Open **Developer Settings** from your profile and create an API token.
3. Copy `.env.example` to `.env` and set `STARTGG_API_TOKEN`.
4. In the dashboard, choose **StartGG**, enter an event URL or slug, and load it.

`STARTGG_API_TOKEN` is read only by the server and is never sent to either browser client or written to the state file. Keep `.env` private. The adapter calls only the official read-only GraphQL endpoint, `https://api.start.gg/gql/alpha`, and contains no mutations or undocumented website calls.

Accepted event inputs include:

```text
https://www.start.gg/tournament/genesis-9/event/melee-singles
tournament/genesis-9/event/melee-singles
genesis-9/event/melee-singles
```

An absent token, invalid input, provider error, or stale connection is reported explicitly in the dashboard.

## Production

```bash
npm run build
npm start
```

The production server serves:

- Dashboard: <http://127.0.0.1:3100/>
- Live overlay: <http://127.0.0.1:3100/overlay/>
- Health JSON: <http://127.0.0.1:3100/api/health>
- WebSocket: `ws://127.0.0.1:3100/ws`

Use the dashboard's **Copy OBS URL** or **Open overlay** action instead of constructing the URL manually.

## OBS browser source

1. Run the production server.
2. Add an OBS **Browser** source.
3. Use `http://127.0.0.1:3100/overlay/`.
4. Set width to `1920` and height to `1080`.
5. Enable **Refresh browser when scene becomes active** if desired.

The page background is transparent. The overlay reconnects automatically and receives a complete snapshot after reconnecting; it never contacts StartGG directly. Choose **Octagon** or **Minimal** from the dashboard's live-scene rail and the existing OBS source switches immediately. To pin a source to one design, add `?template=octagon` or `?template=minimal` to its URL.

## Architecture

```text
src/
  server/        Fastify API, WebSocket hub, polling, state, static hosting
  dashboard/     React/Vite operator surface
  overlay/       Shared OBS runtime and repository-hosted template registry
  providers/     Provider interface, registry, and StartGG adapter
  shared/        Domain contracts, message schemas, and browser socket client
```

The server is the single authority. A provider returns normalized immutable source data. Local `PresentationState` separately records selected sides and safe overrides. `deriveOverlayView` combines them into the stable provider-neutral contract broadcast to both clients. Swapping sides therefore cannot mutate entrant or set data.

Operator choices are persisted atomically to `.data/operator-state.json` with a temporary-file write and rename. The file contains provider/event/phase/set and presentation choices only; it never contains credentials.

### Live protocol

Clients connect to `/ws` and identify themselves:

```json
{"type":"client.hello","protocolVersion":3,"client":"dashboard"}
```

The server answers with the complete current state:

```ts
{ type: "state.snapshot"; state: ServerState }
```

Dashboard commands are correlated:

```json
{
  "type":"command",
  "commandId":"operator-42",
  "command":{"type":"overlay.select","templateId":"minimal"}
}
```

The server responds with `command.ack` or `command.error`, then broadcasts a fresh `state.snapshot` when state changes. All messages are validated against the shared Zod contracts. Reconnect uses bounded exponential delay and always resynchronizes from a full snapshot.

## Polling and rate limits

- Event metadata loads first; sets are fetched lazily for the selected phase group.
- Phase-group pages are requested sequentially through a shared one-request-per-second limiter.
- Rate-limit responses honor `Retry-After` and otherwise use bounded exponential backoff.
- List queries fetch lightweight entrant data; full profiles load only for the selected set.
- Only the selected set is polled, once centrally by the server.
- The default interval is 15 seconds (`POLL_INTERVAL_MS`).
- Provider failures use bounded exponential backoff, capped at 120 seconds.
- Connection state distinguishes idle, loading, fresh, stale, and error, with the last successful update exposed to clients.

This keeps StartGG request volume independent of dashboard or overlay client count. Operators should still choose an interval appropriate for their event and StartGG allowance.

## Add an overlay design

1. Add a self-contained component, stylesheet, and assets under `src/overlay/templates/<id>/`.
2. Add its public metadata and ID to `src/shared/overlay-templates.ts`.
3. Register its lazy import in `src/overlay/registry.ts`.
4. Render only the provider-neutral `OverlayView` passed to the template.

The dashboard automatically builds its design switcher from the shared metadata. Templates reuse the same WebSocket connection, scaling, loading state, and stable `/overlay/` OBS URL.

## Add a provider

1. Implement `TournamentDataProvider` in `src/providers`.
2. Parse and validate the provider's response inside that adapter.
3. Normalize it to `NormalizedEvent` and `NormalizedSet`; do not export provider-specific API types.
4. Register the adapter in `createProviderRegistry`.
5. Add the provider ID to the shared contract and dashboard selector.
6. Add adapter normalization fixtures and error-path tests.

This provider-neutral path is intended for a future ParryGG implementation. Dashboard, overlay, persistence, polling, and WebSocket code should not need provider-specific branches.

## Development commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

CI runs install, lint, typecheck, tests, and build on Node 24.

## Current limitations

- StartGG is read-only.
- Public StartGG GraphQL does not expose live stage-strike, DSR task state, or the complete TournamentStreamHelper workflow; those features are intentionally outside this MVP.
- Large phase groups can take time to load because StartGG pages are fetched conservatively to stay within provider limits.
- Optional entrant metadata such as pronouns, social handle, and location is shown only when a provider supplies it.
- The server is local and single-operator; it has no authentication or remote multi-user conflict model.
