Tournament Overlay @@VERSION@@ — Linux x64

Requires Linux kernel 4.18 or later and glibc 2.28 or later (not musl/Alpine).
Node.js is included; no root access or separate Node installation is required.

LAUNCH
Extract the complete tar.gz into a folder owned by your user, for example:
  mkdir -p "$HOME/.local/opt/tournament-overlay-@@VERSION@@"
  tar -xzf tournament-overlay-linux-x64.tar.gz -C "$HOME/.local/opt/tournament-overlay-@@VERSION@@"
  "$HOME/.local/opt/tournament-overlay-@@VERSION@@/TournamentOverlay"
Keep TournamentOverlay, public/, and build-info.json together. Leave the terminal
open; Ctrl+C stops the server. The dashboard opens via xdg-open if available.
Otherwise open http://127.0.0.1:3100/ yourself (unless PORT is overridden).
Closing the browser does not stop the server. No service or autostart is installed.

OPTIONAL DESKTOP LAUNCHER
Create ~/.local/share/applications/tournament-overlay.desktop with:
  [Desktop Entry]
  Type=Application
  Name=Tournament Overlay
  Exec="/absolute/path/to/TournamentOverlay"
  Terminal=true
  Categories=AudioVideo;
Replace the quoted absolute path with your actual executable path. Desktop Entry
Exec values do not expand ~ or $HOME. Keep Terminal=true so Ctrl+C can stop it.

UPGRADES AND DATA
Stop the old process before switching versions. Extract a new release into a new
folder instead of merging old and new public assets; update the launcher path.
Refresh open dashboard and overlay tabs after restarting an updated app.
By default, configuration, credentials, and operator state are stored in:
  ${XDG_CONFIG_HOME:-$HOME/.config}/tournament-overlay/
These are outside the application folder and survive application replacement.
Back up that directory before upgrading. Restore the complete backup if reverting
to an older release that cannot read the newer data format.
Custom CONFIG_FILE and STATE_FILE locations remain your responsibility: never
put user data inside the replaceable application directory.
Verify the archive against SHA256SUMS.txt from the official release.
