import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../shared/app-info.ts";
import { PROTOCOL_VERSION } from "../shared/contracts.ts";
import { assertMatchingBrowserAssets } from "./browser-assets.ts";
import { buildApp } from "./app.ts";
import { ProviderRegistry } from "../providers/index.ts";
import { fixtureProvider, MemoryOperatorStore } from "./fixtures.test-support.ts";
import { TournamentService } from "./service.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function assets(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "overlay-browser-assets-"));
  directories.push(directory);
  await mkdir(join(directory, "overlay"));
  for (const target of [directory, join(directory, "overlay")]) {
    await writeFile(join(target, "index.html"), "<!doctype html><title>Tournament Overlay</title>");
    await writeFile(join(target, "app-build.json"), JSON.stringify({
      appVersion: APP_VERSION, protocolVersion: PROTOCOL_VERSION,
    }));
  }
  return directory;
}

describe("matching browser packages", () => {
  it("accepts matching dashboard and overlay manifests", async () => {
    await expect(assertMatchingBrowserAssets(await assets())).resolves.toBeUndefined();
  });

  it.each(["app-build.json", "overlay/app-build.json"])("refuses an older %s before serving browser assets", async (path) => {
    const directory = await assets();
    await writeFile(join(directory, path), JSON.stringify({
      appVersion: "0.0.1", protocolVersion: PROTOCOL_VERSION,
    }));
    await expect(assertMatchingBrowserAssets(directory)).rejects.toThrow("Install the complete release");
  });

  it("refuses missing manifests rather than silently mixing releases", async () => {
    const directory = await assets();
    await rm(join(directory, "overlay/app-build.json"));
    await expect(assertMatchingBrowserAssets(directory)).rejects.toThrow("npm run build");
  });

  it("does not cache entry pages or build manifests across an upgrade", async () => {
    const directory = await assets();
    const service = new TournamentService(new ProviderRegistry([fixtureProvider()]), new MemoryOperatorStore(), 60_000);
    const app = await buildApp(service, directory);
    try {
      for (const url of ["/", "/overlay/", "/app-build.json", "/overlay/app-build.json"]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    } finally {
      service.close();
      await app.close();
    }
  });
});
