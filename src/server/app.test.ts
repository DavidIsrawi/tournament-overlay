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
import { APP_VERSION } from "../shared/app-info.ts";
import { PROTOCOL_VERSION } from "../shared/contracts.ts";
import { describeRelease, UpdateCheckError } from "./updates.ts";

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

describe("application update API", () => {
  it("exposes the bundled version without checking GitHub on startup or health requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-update-api-"));
    directories.push(directory);
    const service = createService(directory);
    const checkForUpdates = vi.fn(() => Promise.reject(new UpdateCheckError("Offline")));
    const app = await buildApp(service, join(directory, "public"), undefined, { checkForUpdates });
    try {
      const info = await app.inject("/api/app");
      expect(info.statusCode).toBe(200);
      expect(info.json()).toMatchObject({
        version: APP_VERSION, protocolVersion: PROTOCOL_VERSION, platform: process.platform, architecture: process.arch,
      });
      expect(info.headers["cache-control"]).toBe("no-store");
      await app.inject("/api/health");
      expect(checkForUpdates).not.toHaveBeenCalled();
      const revision = service.getState().revision;
      const failure = await app.inject({ method: "POST", url: "/api/updates/check" });
      expect(failure.statusCode).toBe(502);
      expect(failure.json()).toEqual({ error: "Offline" });
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      expect(service.getState().revision).toBe(revision);
      expect((await app.inject("/api/health")).statusCode).toBe(200);
    } finally {
      service.close();
      await app.close();
    }
  });

  it("returns release details only after an explicit check", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-update-api-"));
    directories.push(directory);
    const service = createService(directory);
    const result = describeRelease({
      tag_name: "v0.4.0", html_url: "https://github.com/DavidIsrawi/tournament-overlay/releases/tag/v0.4.0",
      draft: false, prerelease: false, assets: [],
    }, APP_VERSION, null, "2026-09-06T00:00:00.000Z");
    const app = await buildApp(service, join(directory, "public"), undefined, {
      checkForUpdates: () => Promise.resolve(result),
    });
    try {
      const response = await app.inject({ method: "POST", url: "/api/updates/check" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      service.close();
      await app.close();
    }
  });
});
