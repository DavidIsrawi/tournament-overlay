Tournament Overlay @@VERSION@@ — macOS

Requires macOS 13.5 or later. Node.js is included; no separate installation needed.

INSTALL
Open the DMG and drag Tournament Overlay.app onto the Applications shortcut.
Eject the disk image, then open Tournament Overlay from Applications. Do not run
the app directly from the mounted DMG. Launching opens the dashboard in your
default browser at http://127.0.0.1:3100/ (unless PORT is overridden).
For an account without permission to write /Applications, copy the app into
~/Applications instead.

This build is not Developer ID signed or notarized. The app and its embedded
executables have ad-hoc signatures only. Gatekeeper may block
launching it. Verify the download and SHA256SUMS.txt against the official release;
consult macOS Privacy & Security for its per-app approval options. Do not disable
Gatekeeper globally. Managed Macs may disallow unnotarized applications.

STOPPING AND UPGRADING
The native app owns the local server. Closing the browser does not quit it.
Open the app again (or use its Open dashboard menu action) to reopen the existing
dashboard without starting a second server. Choose Quit Tournament Overlay from
the application menu, press Command+Q while the app is active, or choose Quit in
its Dock menu to stop the app and server. Quit before replacing the entire .app
with a newer version. Do not replace just the executable or public directory.
The app does not automatically restart, update itself, or start at login.
After restarting an updated app, refresh open dashboard and overlay browser tabs.

PORTABLE ARCHIVE
Extract the complete tar.gz into its own folder, keeping TournamentOverlay,
public/, and build-info.json together. Run ./TournamentOverlay in Terminal;
Ctrl+C stops it. To launch the native .app from Terminal, use:
  open "/Applications/Tournament Overlay.app"
If browser launch fails, open http://127.0.0.1:3100/ manually.

YOUR DATA
By default, configuration, credentials, and operator state are stored separately:
  ~/Library/Application Support/Tournament Overlay/
Replacing or deleting the application does not remove that directory.
Back it up before upgrading. Restore the complete backup if deliberately reverting
to an older release that cannot read the newer data format.
Custom CONFIG_FILE and STATE_FILE locations remain your responsibility: never
put user data inside the .app or another replaceable application directory.
