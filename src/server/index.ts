import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";
import { ProviderRegistry, StartGgProvider } from "../providers/index.ts";
import { buildApp } from "./app.ts";
import { AtomicOperatorStateStore } from "./persistence.ts";
import { TournamentService } from "./service.ts";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
config({ path: resolve(repositoryRoot, ".env") });

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(120_000).default(15_000),
  STATE_FILE: z.string().min(1).default(".data/operator-state.json"),
  STARTGG_API_TOKEN: z.string().min(1).optional(),
});

const environment = environmentSchema.parse(process.env);
const stateFile = resolve(repositoryRoot, environment.STATE_FILE);
const publicDirectory = resolve(repositoryRoot, "dist/public");

const providers = new ProviderRegistry([
  new StartGgProvider(environment.STARTGG_API_TOKEN),
]);
const service = new TournamentService(
  providers,
  new AtomicOperatorStateStore(stateFile),
  environment.POLL_INTERVAL_MS,
);
await service.initialize();

const app = await buildApp(service, publicDirectory);
await app.listen({ host: "127.0.0.1", port: environment.PORT });

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
