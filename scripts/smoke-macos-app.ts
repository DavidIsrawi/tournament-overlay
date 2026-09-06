import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin" || !process.env.MACOS_APP_PATH) {
  throw new Error("Run on macOS with MACOS_APP_PATH pointing to the packaged .app.");
}

const directory = await mkdtemp(join(tmpdir(), "overlay-reopen-"));
const app = join(directory, "Tournament Overlay.app");
const identifier = `io.github.davidisrawi.tournament-overlay.smoke-${randomUUID()}`;
const output = join(directory, "launcher.log");
const errors = join(directory, "launcher-errors.log");
let launcherPid: number | undefined;
let serverPid: number | undefined;

function execute(file: string, args: string[]): string {
  const environment = { ...process.env };
  delete environment.STARTGG_API_TOKEN;
  delete environment.PUBLIC_DIRECTORY;
  return execFileSync(file, args, { encoding: "utf8", timeout: 30_000, env: environment }).trim();
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) { return; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const log = existsSync(output) ? await readFile(output, "utf8") : "";
  const stderr = existsSync(errors) ? await readFile(errors, "utf8") : "";
  throw new Error(`${message}\n${log}\n${stderr}`);
}

async function readLog(): Promise<string> {
  return existsSync(output) ? await readFile(output, "utf8") : "";
}

async function availablePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolveListen, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolveListen);
  });
  const address = socket.address();
  assert(address !== null && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) => {
    socket.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}

try {
  await cp(resolve(process.env.MACOS_APP_PATH), app, { recursive: true });
  // A unique test identity prevents LaunchServices from reopening the user's installed app.
  execute("plutil", ["-replace", "CFBundleIdentifier", "-string", identifier, join(app, "Contents/Info.plist")]);
  execute("codesign", ["--force", "--sign", "-", app]);
  const port = await availablePort();
  const launch = async (): Promise<void> => {
    await writeFile(output, "");
    await writeFile(errors, "");
    execute("open", [
      "-n", "-a", app, "--stdout", output, "--stderr", errors,
      "--env", `PORT=${String(port)}`, "--env", "OPEN_BROWSER=false",
      "--env", `CONFIG_FILE=${join(directory, "config.json")}`,
      "--env", `STATE_FILE=${join(directory, "operator-state.json")}`,
    ]);
    await waitFor(async () => /launcher-started \d+/.test(await readLog()), "The native app did not start.");
    launcherPid = Number((await readLog()).match(/launcher-started (\d+)/)?.[1]);
    assert(Number.isSafeInteger(launcherPid));
    await waitFor(async () => (await readLog()).includes("dashboard-requested "), "The app did not request its dashboard.");
    const owner = execute("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-t"]);
    assert.match(owner, /^\d+$/);
    assert.equal(execute("ps", ["-p", owner, "-o", "command="]), join(app, "Contents/MacOS/TournamentOverlay"));
    serverPid = Number(owner);
    assert.equal(Number(execute("ps", ["-p", owner, "-o", "ppid="])), launcherPid);
    assert.equal((await fetch(`http://127.0.0.1:${String(port)}/api/app`)).status, 200);
  };

  const quit = async (): Promise<void> => {
    execute("osascript", ["-e", `tell application id "${identifier}" to quit`]);
    await waitFor(
      () => launcherPid !== undefined && serverPid !== undefined && !isRunning(launcherPid) && !isRunning(serverPid),
      "Quitting the native app did not stop its owned server.",
    );
    launcherPid = undefined;
    serverPid = undefined;
  };

  await launch();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = (await readLog()).split("dashboard-requested ").length - 1;
    // Deliberately omit -n: this exercises Finder's reopen event on the existing process.
    execute("open", ["-a", app]);
    await waitFor(
      async () => (await readLog()).split("dashboard-requested ").length - 1 > before,
      "Reopening the app did not request the existing dashboard.",
    );
    assert.equal((await readLog()).split("launcher-started ").length - 1, 1);
    assert.equal(execute("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-t"]), String(serverPid));
  }
  await quit();
  await launch();
  await quit();
  console.log("Native app launch, repeated Finder reopen, single-server ownership, Quit and relaunch passed.");
} finally {
  for (const pid of [launcherPid, serverPid]) {
    if (pid !== undefined && isRunning(pid)) {
      process.kill(pid, "SIGTERM");
      await waitFor(() => !isRunning(pid), `Test process ${String(pid)} did not stop.`);
    }
  }
  await rm(directory, { recursive: true, force: true });
}
