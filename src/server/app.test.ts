import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderRegistry,
  type TournamentDataProvider,
} from "../providers/index.ts";
import { buildApp } from "./app.ts";
import { AtomicOperatorStateStore } from "./persistence.ts";
import { TournamentService } from "./service.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function createService(directory: string): TournamentService {
  const provider: TournamentDataProvider = {
    descriptor: { id: "startgg", name: "StartGG", configured: false },
    loadEvent: () => Promise.reject(new Error("Not configured")),
    loadPhaseGroupSets: () => Promise.reject(new Error("Not configured")),
    loadSet: () => Promise.reject(new Error("Not configured")),
  };
  return new TournamentService(
    new ProviderRegistry([provider]),
    new AtomicOperatorStateStore(join(directory, "state.json")),
    120_000,
  );
}

describe("credential settings API", () => {
  it("saves a token without returning it to the browser", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-app-"));
    directories.push(directory);
    const service = createService(directory);
    const saveStartGgToken = vi.fn<(token: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const app = await buildApp(service, join(directory, "public"), {
      saveStartGgToken,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/settings/startgg-token",
      payload: { token: "  private-token  " },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(saveStartGgToken).toHaveBeenCalledWith("private-token");
    await app.close();
    service.close();
  });

  it("rejects an empty token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-app-"));
    directories.push(directory);
    const service = createService(directory);
    const app = await buildApp(service, join(directory, "public"), {
      saveStartGgToken: () => Promise.resolve(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/settings/startgg-token",
      payload: { token: " " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Enter a valid StartGG API token.",
    });
    await app.close();
    service.close();
  });
});
