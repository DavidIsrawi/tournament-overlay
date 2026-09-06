Tournament Overlay @@VERSION@@ — Windows x64

Requires Windows 10/Server 2016 or later. Node.js is included.

INSTALL
Run tournament-overlay-windows-x64-setup.exe. It installs for the current user,
without requesting administrator access, into:
  %LOCALAPPDATA%\Programs\Tournament Overlay
Start Tournament Overlay from the Start Menu. Its console opens along with the
dashboard in your default browser at http://127.0.0.1:3100/ (unless PORT is set).
The installer is unsigned. Windows SmartScreen may warn about the download.
Verify its SHA256SUMS.txt checksum against the official release before proceeding.
The installer does not launch the application automatically.

STOPPING AND UPGRADING
Keep the console open while using the overlay; Ctrl+C stops the server.
Closing the browser does not stop it. If necessary, use Task Manager to end
TournamentOverlay.exe. Stop it before installing a newer version or uninstalling;
the installer refuses to replace a running executable and never restarts it.
Re-run the new installer to update the application and assets together. The app\
subfolder is reserved for the replaceable versioned payload; do not store files
there. Refresh open dashboard and overlay tabs after restarting an updated app.

PORTABLE ZIP
Extract the entire ZIP into its own folder. Keep TournamentOverlay.exe, public/,
and build-info.json together. Double-click TournamentOverlay.exe to launch it.
When upgrading a portable copy, extract into a new folder, not on top of an old
public directory. Portable and installed copies share the default user data;
do not run them simultaneously. If browser launch fails, open the URL manually.

YOUR DATA AND UNINSTALLING
Configuration, credentials, and operator state live outside the installation:
  %APPDATA%\Tournament Overlay
Updates and the Windows Installed apps / Start Menu uninstaller preserve this
directory. Back it up before upgrading. Restore the complete backup if deliberately
reverting to an older release that cannot read the newer data format.
Custom CONFIG_FILE and STATE_FILE locations remain your responsibility: never
put user data inside the installation folder.
Uninstalling does not delete credentials or data; delete that separate directory
yourself only if you intend to permanently remove them.
