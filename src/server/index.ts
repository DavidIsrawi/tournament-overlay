import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { isSea } from "node:sea";
import { config } from "dotenv";
import { z } from "zod";
import { ProviderRegistry, StartGgProvider } from "../providers/index.ts";
import { buildApp } from "./app.ts";
import {
  AtomicLocalConfigStore,
  defaultUserConfigDirectory,
} from "./local-config.ts";
import { AtomicOperatorStateStore } from "./persistence.ts";
import { TournamentService } from "./service.ts";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(120_000).default(15_000),
  STATE_FILE: z.string().min(1).optional(),
  CONFIG_FILE: z.string().min(1).optional(),
  PUBLIC_DIRECTORY: z.string().min(1).optional(),
  OPEN_BROWSER: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  STARTGG_API_TOKEN: z.string().min(1).optional(),
});

async function main(): Promise<void> {
  const executableMode = isSea();
  const applicationRoot = executableMode
    ? dirname(process.execPath)
    : process.cwd();
  config({ path: resolve(applicationRoot, ".env") });
  const environment = environmentSchema.parse(process.env);
  const userConfigDirectory = defaultUserConfigDirectory();
  const resolveRuntimePath = (value: string): string =>
    isAbsolute(value) ? value : resolve(applicationRoot, value);

  const configFile =
    environment.CONFIG_FILE === undefined
      ? resolve(userConfigDirectory, "config.json")
      : resolveRuntimePath(environment.CONFIG_FILE);
  const stateFile =
    environment.STATE_FILE === undefined
      ? resolve(userConfigDirectory, "operator-state.json")
      : resolveRuntimePath(environment.STATE_FILE);
  const publicDirectory =
    environment.PUBLIC_DIRECTORY === undefined
      ? resolve(applicationRoot, executableMode ? "public" : "dist/public")
      : resolveRuntimePath(environment.PUBLIC_DIRECTORY);
  const localConfigStore = new AtomicLocalConfigStore(configFile);
  const localConfig = await localConfigStore.load();
  const startGgToken =
    environment.STARTGG_API_TOKEN?.trim() || localConfig.startggApiToken;

  const providers = new ProviderRegistry([
    new StartGgProvider(startGgToken ?? undefined),
  ]);
  const service = new TournamentService(
    providers,
    new AtomicOperatorStateStore(stateFile),
    environment.POLL_INTERVAL_MS,
  );
  const app = await buildApp(service, publicDirectory, {
    saveStartGgToken: async (token) => {
      await localConfigStore.saveStartGgToken(token);
      service.replaceProvider(new StartGgProvider(token));
    },
  });
  void service.initialize().catch((error: unknown) => {
    app.log.error(error, "Failed to initialize persisted operator state");
  });
  await app.listen({ host: "127.0.0.1", port: environment.PORT });
  const dashboardUrl = `http://127.0.0.1:${String(environment.PORT)}/`;
  app.log.info(
    { dashboardUrl, configFile, stateFile },
    "Tournament Overlay is ready",
  );

  if (environment.OPEN_BROWSER ?? executableMode) {
    const command =
      process.platform === "darwin"
        ? { file: "open", arguments: [dashboardUrl] }
        : process.platform === "win32"
          ? {
              file: "cmd.exe",
              arguments: ["/d", "/s", "/c", `start "" "${dashboardUrl}"`],
            }
          : { file: "xdg-open", arguments: [dashboardUrl] };
    const browser = spawn(command.file, command.arguments, {
      detached: true,
      stdio: "ignore",
    });
    browser.once("error", (error) => {
      app.log.warn(
        error,
        "Could not open the dashboard in the default browser",
      );
    });
    browser.unref();
  }

  const shutdown = async (): Promise<void> => {
    service.close();
    await app.close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  console.error("Tournament Overlay failed to start.", error);
  process.exitCode = 1;
});
