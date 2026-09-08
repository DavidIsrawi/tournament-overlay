import { randomUUID } from "node:crypto";
import type * as FileSystem from "node:fs/promises";
import { mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AtomicLocalConfigStore,
  defaultUserConfigDirectory,
} from "./local-config.ts";

vi.mock("node:fs/promises", { spy: true });
vi.mock("node:crypto", { spy: true });

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AtomicLocalConfigStore", () => {
  async function createStore() {
    const directory = await mkdtemp(join(tmpdir(), "overlay-config-"));
    directories.push(directory);
    const filePath = join(directory, "config.json");
    return { directory, filePath, store: new AtomicLocalConfigStore(filePath) };
  }

  it("serializes simultaneous saves and reads even when timestamps coincide", async () => {
    const { directory, store } = await createStore();
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const first = store.saveStartGgToken("first-token");
    const firstRead = store.load();
    const second = store.saveStartGgToken("second-token");
    const secondRead = store.load();
    await Promise.all([first, second]);
    await expect(firstRead).resolves.toEqual({ startggApiToken: "first-token" });
    await expect(secondRead).resolves.toEqual({ startggApiToken: "second-token" });
    expect(await readdir(directory)).toEqual(["config.json"]);
  });

  it.each(["writeFile", "sync", "close"] as const)(
    "preserves the previous token and removes partial files after %s fails",
    async (operation) => {
      const { directory, filePath, store } = await createStore();
      await store.saveStartGgToken("previous-token");
      const original = await readFile(filePath);
      const error = new Error(`Credential ${operation} failed`);
      const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
      vi.mocked(open).mockImplementationOnce(async (...args) => {
        const file = await actual.open(...args);
        await file.writeFile("partial");
        vi.spyOn(file, operation).mockRejectedValueOnce(error);
        return file;
      });
      await expect(store.saveStartGgToken("replacement-token")).rejects.toBe(error);
      expect(await readFile(filePath)).toEqual(original);
      expect(await readdir(directory)).toEqual(["config.json"]);
      await store.saveStartGgToken("recovered-token");
      await expect(store.load()).resolves.toEqual({ startggApiToken: "recovered-token" });
    },
  );

  it("cleans up a failed rename and allows the next queued save to succeed", async () => {
    const { directory, filePath, store } = await createStore();
    await store.saveStartGgToken("previous-token");
    const error = new Error("Rename denied");
    vi.mocked(rename).mockRejectedValueOnce(error);
    await expect(store.saveStartGgToken("failed-token")).rejects.toBe(error);
    expect(await readFile(filePath, "utf8")).toContain("previous-token");
    expect(await readdir(directory)).toEqual(["config.json"]);
    await store.saveStartGgToken("recovered-token");
    await expect(store.load()).resolves.toEqual({ startggApiToken: "recovered-token" });
  });

  it("does not overwrite or delete a temporary file belonging to another writer", async () => {
    const { filePath, store } = await createStore();
    await store.saveStartGgToken("previous-token");
    const id = "00000000-0000-4000-8000-000000000000";
    vi.mocked(randomUUID).mockReturnValue(id);
    const temporaryPath = `${filePath}.${id}.tmp`;
    await writeFile(temporaryPath, "another writer");
    await expect(store.saveStartGgToken("replacement-token")).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(temporaryPath, "utf8")).toBe("another writer");
    await expect(store.load()).resolves.toEqual({ startggApiToken: "previous-token" });
  });

  it("rejects blank tokens before creating a file and keeps the queue usable", async () => {
    const { directory, store } = await createStore();
    await expect(store.saveStartGgToken("   ")).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
    await store.saveStartGgToken("valid-token");
    await expect(store.load()).resolves.toEqual({ startggApiToken: "valid-token" });
  });

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
