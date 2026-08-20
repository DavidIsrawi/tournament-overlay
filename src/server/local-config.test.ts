import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AtomicLocalConfigStore,
  defaultUserConfigDirectory,
} from "./local-config.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AtomicLocalConfigStore", () => {
  it("persists a trimmed StartGG token in a user-only file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-config-"));
    directories.push(directory);
    const filePath = join(directory, "nested", "config.json");
    const store = new AtomicLocalConfigStore(filePath);

    await store.saveStartGgToken("  local-token  ");

    await expect(store.load()).resolves.toEqual({
      startggApiToken: "local-token",
    });
    expect(await readFile(filePath, "utf8")).not.toContain("  local-token  ");
    if (process.platform !== "win32") {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("returns an empty configuration when the file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-config-"));
    directories.push(directory);
    const store = new AtomicLocalConfigStore(join(directory, "missing.json"));

    await expect(store.load()).resolves.toEqual({
      startggApiToken: null,
    });
  });
});

describe("defaultUserConfigDirectory", () => {
  it("uses the native per-user configuration location", () => {
    expect(defaultUserConfigDirectory("darwin", {}, "/Users/operator")).toBe(
      "/Users/operator/Library/Application Support/Tournament Overlay",
    );
    expect(
      defaultUserConfigDirectory(
        "win32",
        { APPDATA: "C:\\Users\\operator\\AppData\\Roaming" },
        "C:\\Users\\operator",
      ),
    ).toContain("Tournament Overlay");
    expect(
      defaultUserConfigDirectory(
        "linux",
        { XDG_CONFIG_HOME: "/home/operator/.local-config" },
        "/home/operator",
      ),
    ).toBe("/home/operator/.local-config/tournament-overlay");
  });
});
