import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from "../src/shared/contracts.ts";

interface ExecutableProcess {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly getOutput: () => string;
}

const executablePath = resolve(
  "dist/executable",
  process.platform === "win32"
    ? "TournamentOverlay.exe"
    : "TournamentOverlay",
);

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a smoke-test port.");
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
  return address.port;
}

function launchExecutable(
  port: number,
  configFile: string,
  stateFile: string,
): ExecutableProcess {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CONFIG_FILE: configFile,
    STATE_FILE: stateFile,
    OPEN_BROWSER: "false",
    PORT: String(port),
  };
  delete environment.STARTGG_API_TOKEN;
  const child = spawn(executablePath, [], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  return { child, getOutput: () => output };
}

async function waitForServer(
  baseUrl: string,
  processState: ExecutableProcess,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (processState.child.exitCode !== null) {
      throw new Error(
        `Executable exited before becoming ready.\n${processState.getOutput()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The process may still be binding its local port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `Executable did not become ready in time.\n${processState.getOutput()}`,
  );
}

async function readProviderConfiguration(
  baseUrl: string,
): Promise<boolean | undefined> {
  return await new Promise<boolean | undefined>(
    (resolveConfiguration, reject) => {
      const socket = new WebSocket(baseUrl.replace("http:", "ws:") + "/ws");
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out waiting for a WebSocket state snapshot."));
      }, 5_000);
      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "client.hello",
            protocolVersion: PROTOCOL_VERSION,
            client: "dashboard",
          }),
        );
      });
      socket.addEventListener("message", (event) => {
        const parsed = serverMessageSchema.safeParse(
          JSON.parse(String(event.data)),
        );
        if (!parsed.success || parsed.data.type !== "state.snapshot") {
          return;
        }
        clearTimeout(timeout);
        socket.close();
        resolveConfiguration(
          parsed.data.state.providers.find(
            (provider) => provider.id === "startgg",
          )?.configured,
        );
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Could not read the executable WebSocket state."));
      });
    },
  );
}

async function stopExecutable(
  processState: ExecutableProcess,
): Promise<void> {
  if (processState.child.exitCode !== null) {
    return;
  }
  const stopped = new Promise<void>((resolveExit) => {
    processState.child.once("exit", () => resolveExit());
  });
  processState.child.kill();
  await Promise.race([
    stopped,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Executable did not stop cleanly.\n${processState.getOutput()}`,
            ),
          ),
        5_000,
      ),
    ),
  ]);
}

const directory = await mkdtemp(
  resolve(tmpdir(), "tournament-overlay-executable-"),
);
const configFile = resolve(directory, "config.json");
const stateFile = resolve(directory, "operator-state.json");
const port = await findAvailablePort();
const baseUrl = `http://127.0.0.1:${String(port)}`;
let processState = launchExecutable(port, configFile, stateFile);

try {
  await waitForServer(baseUrl, processState);
  for (const path of ["/", "/overlay/"]) {
    const response = await fetch(`${baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${String(response.status)}.`);
    }
  }
  const saveResponse = await fetch(
    `${baseUrl}/api/settings/startgg-token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "release-smoke-test-token" }),
    },
  );
  if (saveResponse.status !== 204) {
    throw new Error(
      `Token setup returned HTTP ${String(saveResponse.status)}.`,
    );
  }
  await stopExecutable(processState);

  processState = launchExecutable(port, configFile, stateFile);
  await waitForServer(baseUrl, processState);
  if ((await readProviderConfiguration(baseUrl)) !== true) {
    throw new Error("The saved token was not restored after restart.");
  }
  console.log("Executable smoke test passed.");
} finally {
  await stopExecutable(processState);
  await rm(directory, { recursive: true, force: true });
}
