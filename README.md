# Tournament Overlay

A local, read-only tournament operator dashboard and OBS browser-source overlay. One Node server owns provider access, polling, presentation state, persistence, and live updates; browser clients never contact StartGG.

## Install a release

Download the package for your computer from
[GitHub Releases](https://github.com/DavidIsrawi/tournament-overlay/releases).
Release packages include Node.js; you do not need to install a runtime.

| Computer | Recommended download | Installation |
| --- | --- | --- |
| macOS Apple Silicon | `tournament-overlay-macos-arm64.dmg` | Open the disk image, drag **Tournament Overlay.app** to Applications, eject the image, and launch the installed app. |
| macOS Intel | `tournament-overlay-macos-x64.dmg` | Use the same drag-to-Applications flow. |
| Windows x64 | `tournament-overlay-windows-x64-setup.exe` | Run the per-user installer, then launch Tournament Overlay from the Start Menu. |
| Linux x64 | `tournament-overlay-linux-x64.tar.gz` | Extract the complete archive and run `./TournamentOverlay` from its directory. |

Portable archives remain available for macOS and Windows. Keep the executable
and its `public/` directory together; copying just the executable is not enough.
The app opens your dashboard in the default browser. The default OBS browser
source remains <http://127.0.0.1:3100/overlay/>.

These packages are not publisher-signed or notarized: macOS builds are ad-hoc
signed and Windows builds are unsigned. Operating-system security warnings may
appear. `SHA256SUMS.txt` lets you check download integrity; checksums are not a
replacement for publisher signatures.

## Quick start (development)

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
3. Start the app and paste the token into the first-run setup screen. For
   development, you can instead copy `.env.example` to `.env` and set
   `STARTGG_API_TOKEN`.
4. In the dashboard, choose **StartGG**, enter an event URL or slug, and load it.
5. Select a set to preview, then press **Take live** to put it on air.

Browsing sets, phases, or another event never replaces the live scoreboard.
**Take live** fetches the latest set details before switching; a failed fetch
leaves the previous scene on air. Side swaps and overlay-design changes apply
to the live output immediately.

The setup screen stores the token in the current user's local configuration
directory with owner-only file permissions. It is read only by the server and
is never included in browser state, sent to OBS, or written to the operator
state file. Keep the local configuration and `.env` private. The adapter calls
only the official read-only GraphQL endpoint,
`https://api.start.gg/gql/alpha`, and contains no mutations or undocumented
website calls.

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
- Installed version and platform: <http://127.0.0.1:3100/api/app>
- WebSocket: `ws://127.0.0.1:3100/ws`

Use the dashboard's **Copy OBS URL** or **Open overlay** action instead of constructing the URL manually.

## Local executable

Build a native executable package for the current operating system and CPU:

```bash
npm run build:executable
```

The package is written to `dist/executable/` and contains the executable plus
the static `public/` directory. It bundles the Node runtime, so the destination
machine does not need Node.js installed. Launching the executable starts the
local server, opens the dashboard in the default browser, and keeps the OBS URL
available at <http://127.0.0.1:3100/overlay/> while the process is running.

Build each release on its target operating system; the injected Node executable
is platform- and architecture-specific.

Tagged versions matching `v*` are built and smoke-tested by GitHub Actions for
macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64. The workflow
publishes each archive and a `SHA256SUMS.txt` file to the corresponding GitHub
Release. The macOS executables are ad-hoc signed; public distribution without a
Gatekeeper warning requires a Developer ID certificate and notarization.

After building the executable, `npm run package:release` creates native packages
and portable archives in `dist/release/` for the current platform. The release
workflow packages each target before publishing the downloads and checksums.
macOS packaging uses the Xcode Command Line Tools (`swiftc`), `codesign`,
`hdiutil`, and `plutil`. The native AppKit launcher handles Finder reopen events,
reopens the existing dashboard, and owns the server process. **Quit Tournament
Overlay** (or the Dock's Quit action) stops both the app and its server. Closing
the browser alone leaves the server running.
Windows packaging requires Inno Setup
6 (`ISCC_PATH` can point to `ISCC.exe`); the release workflow locates it or installs
it if absent. The installer defaults to `%LOCALAPPDATA%\Programs\Tournament Overlay`
and refuses to replace or uninstall a running executable.

## Updates and saved settings

Open **About & updates** in the dashboard (also available on the first-run token
screen). It shows the installed application version, dashboard version, and
server platform. **Check for updates** contacts the public GitHub stable-release
endpoint only when requested; no GitHub account or token is needed. Successful
checks are cached for five minutes. Offline errors and rate limits do not stop
the broadcast. Prereleases and drafts are excluded, and a newer local version
is never offered an older release as an upgrade.

When available, the download action selects a native package for the running
server's platform and architecture, not the browser's device. If no matching
asset is listed, use the release page to choose a compatible download.
There is no automatic package download, installation, or restart.

Upgrade between broadcasts:

1. Read the release notes and download the new package.
2. Finish the broadcast and stop the running application. Closing the dashboard
   tab does not stop the server. For a portable console launch, press `Ctrl+C`.
   On macOS, choose **Quit Tournament Overlay** from the application menu or
   **Quit** from its Dock menu before replacing the app. When upgrading from the
   earlier headless app wrapper, stop `TournamentOverlay` in Activity Monitor once.
3. Replace the complete macOS app or run the Windows installer. For a portable
   installation, extract the new release into a separate directory; do not copy
   a new executable over an old `public/` folder.
4. Reopen the application, reload the dashboard, and refresh the OBS browser
   source. Keep the existing OBS URL unless you intentionally changed `PORT`.

By default, credentials and operator settings are outside the installation:

| Platform | User configuration directory |
| --- | --- |
| macOS | `~/Library/Application Support/Tournament Overlay/` |
| Windows | `%APPDATA%\Tournament Overlay\` |
| Linux | `$XDG_CONFIG_HOME/tournament-overlay/`, or `~/.config/tournament-overlay/` |

`config.json` contains the StartGG token; `operator-state.json` contains the
preview/live selections and presentation settings. Replacing the application
does not replace these files. The Windows uninstaller preserves them.
Custom `CONFIG_FILE` and `STATE_FILE` paths remain your responsibility; keep
them outside any installation directory you replace.

Saved operator state uses a versioned format. A migration backs up the original
file before rewriting it, and unknown newer formats are rejected rather than
overwritten. The current envelope is
`{ "schemaVersion": 1, "appVersion": "...", "operator": { ... } }`.
Unversioned files migrate as schema 0, preserving their previous live selection.
Their exact original bytes are backed up beside the state file as
`operator-state.json.schema-0.<timestamp-ms>.<uuid>.bak`, with owner-only
permissions. Backups are not automatically deleted; loading an already-current
format does not create another backup just because the app version changed.
If settings cannot be loaded, the dashboard reports the failure
and scene commands are blocked. Downgrades are not automatically safe: stop the
application and preserve the current state before restoring a backup compatible
with the older release. Restoring a backup loses changes made since that backup.
Never restore an old application over newer state
without checking format compatibility.

The server also checks version/protocol manifests in both browser bundles.
Missing or mismatched bundles require reinstalling the complete release (or
`npm run build` in a source checkout). Browser entry pages are not cached across
upgrades. Upgrade and OBS refresh instructions appear only in the operator
dashboard, never on the broadcast overlay. An incompatible overlay retains its
last scoreboard, or stays transparent if it has not received a scene.
Neither client automatically reloads during a broadcast.

## Creating a release

Create a release from a clean, synchronized `main` branch with one semantic
version flag:

```bash
npm run release -- --patch
npm run release -- --minor
npm run release -- --major
```

The wrapper fetches tags, confirms local `main` exactly matches `origin/main`,
runs lint, tests, and the production build, then uses `npm version` to update
`package.json` and `package-lock.json`. It creates a `Release vX.Y.Z` commit and
annotated `vX.Y.Z` tag, then atomically pushes both. Use `--dry-run` with a
version flag to run every check without changing or pushing anything.

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

Operator choices are persisted atomically to `operator-state.json` in the
current user's configuration directory, or the path specified by `STATE_FILE`.
The file contains separate preview and live provider/event/phase/set selections
and presentation choices only; it never contains credentials. Both selections
restore independently after restart. Older saved selections migrate to the live
scene they represented before preview/live separation.

### Live protocol

Clients connect to `/ws` and identify themselves:

```json
{"type":"client.hello","appVersion":"<installed package version>","protocolVersion":6,"client":"dashboard"}
```

The server answers with the complete current state:

```ts
{ type: "state.snapshot"; state: ServerState }
```

The hello must match both the installed application version and protocol version.
A mismatch returns `command.error` with code `client_version_mismatch` and closes
the socket with code `4006`, before accepting commands or sending scene state.
Snapshots include `appVersion` so clients can also detect an incompatible server.

Dashboard commands are correlated:

```json
{
  "type":"command",
  "commandId":"operator-42",
  "command":{"type":"overlay.select","templateId":"minimal"}
}
```

The server broadcasts `state.snapshot` when state changes and responds with
`command.ack` after a command completes, including persistence, or a correlated
`command.error` on failure. An acknowledgment is not merely receipt of a command;
a failed or superseded provider load is not acknowledged as successful. Recent
command IDs are deduplicated within a connection. The dashboard tracks pending
commands and never automatically replays them after disconnect, since the
operation may already have changed the live scene.

`set.select` changes only the preview. To broadcast it, send
`{"type":"live.take","eventId":"<current-event-id>","setId":"<preview-set-id>"}`.
The state carries separate `connection` (bracket) and `liveConnection`
(broadcast set) freshness. All messages are validated against the shared Zod
contracts. Reconnect uses bounded exponential delay and always resynchronizes
from a full snapshot.

## Polling and rate limits

- Event metadata loads first; sets are fetched lazily for the selected phase group.
- Phase-group pages are requested sequentially through a shared one-request-per-second limiter.
- Rate-limit responses honor `Retry-After` and otherwise use bounded exponential backoff.
- List queries fetch lightweight entrant data; full profiles load only for the selected set.
- Only the live set is polled, once centrally by the server, independently of
  bracket navigation or failed refreshes.
- The default interval is 15 seconds (`POLL_INTERVAL_MS`).
- The visible phase group refreshes every 60 seconds. Cached groups carry their
  own `setsFetchedAt` timestamp and are reloaded on return once expired. Live-set
  polls do not advance bracket freshness.
- Transient bracket-load and live-set failures retry automatically; invalid
  input, missing credentials, and missing resources require operator action.
- Provider failures use bounded exponential backoff, capped at 120 seconds.
- Connection state distinguishes idle, loading, fresh, stale, and error, with the last successful update exposed to clients.
- Event metadata paginates phase groups as well as sets. Multi-participant
  entrants retain their team name instead of taking the first player's identity.

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
