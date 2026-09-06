import { randomUUID } from "node:crypto";
import type * as FileSystem from "node:fs/promises";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../shared/app-info.ts";
import { operatorStateSchema, type OperatorState } from "../shared/contracts.ts";
import { AtomicOperatorStateStore, SAVED_STATE_SCHEMA_VERSION } from "./persistence.ts";

vi.mock("node:fs/promises", { spy: true });
vi.mock("node:crypto", { spy: true });

const directories: string[] = [];
const legacyState = {
  providerId: "startgg",
  eventInput: "genesis-9/event/melee-singles",
  selectedPhaseGroupId: "top-8",
  selectedSetId: "set-5",
  presentation: {
    sideOrder: "swapped" as const,
    overlayTemplateId: "minimal" as const,
  },
};
const state: OperatorState = {
  ...legacyState,
  liveSelection: {
    providerId: "startgg",
    eventInput: "genesis-9/event/melee-singles",
    phaseGroupId: "top-8",
    setId: "set-5",
  },
};

function envelope(operator: OperatorState = state, appVersion = APP_VERSION) {
  return { schemaVersion: SAVED_STATE_SCHEMA_VERSION, appVersion, operator };
}

async function createStore() {
  const directory = join(process.cwd(), ".data", `persistence-tests-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directories.push(directory);
  const filePath = join(directory, "state.json");
  return {
    directory,
    filePath,
    store: new AtomicOperatorStateStore(filePath),
  };
}

async function backups(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.endsWith(".bak"));
}

async function expectPrivate(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  }
}

async function failNextPrivateWrite(
  operation: "writeFile" | "sync" | "close",
  error: Error,
): Promise<void> {
  const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const file = await actual.open(...args);
    await file.writeFile("partial");
    vi.spyOn(file, operation).mockRejectedValueOnce(error);
    return file;
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AtomicOperatorStateStore", () => {
  it("restores the last persisted operator scene", async () => {
    const { store, filePath, directory } = await createStore();
    await store.save(state);
    const restored = await store.load({
      ...state,
      selectedSetId: null,
      presentation: {
        sideOrder: "normal",
        overlayTemplateId: "octagon",
      },
    });

    expect(restored).toEqual(state);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(envelope());
    await expectPrivate(filePath);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("returns defaults without creating a file, then permits first and repeated saves", async () => {
    const { directory } = await createStore();
    const filePath = join(directory, "nested", "state.json");
    const store = new AtomicOperatorStateStore(filePath);

    await expect(store.load(state)).resolves.toBe(state);
    expect(await readdir(directory)).toEqual([]);
    await store.save(state);
    const next = { ...state, selectedSetId: "set-6" };
    await store.save(next);
    await expect(store.load(state)).resolves.toEqual(next);
    await expectPrivate(filePath);
    expect(await readdir(join(directory, "nested"))).toEqual(["state.json"]);
  });

  it("backs up exact legacy bytes privately before migrating the live scene", async () => {
    const { store, filePath, directory } = await createStore();
    const legacy = { ...legacyState, eventInput: "tournament/évent" };
    const original = Buffer.from(` \r\n${JSON.stringify(legacy, null, "\t")}\r\n`);
    await writeFile(filePath, original, { mode: 0o644 });
    const expected = {
      ...state,
      eventInput: legacy.eventInput,
      liveSelection: { ...state.liveSelection, eventInput: legacy.eventInput },
    };

    await expect(store.load(state)).resolves.toEqual(expected);
    const names = await backups(directory);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^state\.json\.schema-0\.\d+\.[\da-f-]+\.bak$/);
    const backupPath = join(directory, names[0]!);
    expect(await readFile(backupPath)).toEqual(original);
    await expectPrivate(backupPath);
    await expectPrivate(filePath);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      ...envelope(),
      operator: expected,
    });

    await expect(store.load(state)).resolves.toEqual(expected);
    await expect(new AtomicOperatorStateStore(filePath).load(state)).resolves.toEqual(expected);
    expect(await backups(directory)).toEqual(names);
  });

  it.each([
    { selectedSetId: null },
    { selectedPhaseGroupId: null },
    { eventInput: "   " },
  ])("does not invent a legacy live scene for incomplete selection %j", async (selection) => {
    const { store, filePath } = await createStore();
    await writeFile(filePath, JSON.stringify({ ...legacyState, ...selection }));

    await expect(store.load(state)).resolves.toMatchObject({
      ...selection,
      liveSelection: null,
    });
  });

  it.each([
    null,
    {
      providerId: "startgg",
      eventInput: "other-event",
      phaseGroupId: "other-group",
      setId: "other-set",
    },
  ])("preserves an explicit legacy live selection: %j", async (liveSelection) => {
    const { store, filePath } = await createStore();
    const operator = { ...state, liveSelection };
    await writeFile(filePath, JSON.stringify(operator));

    await expect(store.load(state)).resolves.toEqual(operator);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(envelope(operator));
  });

  it("backs up before applying legacy presentation defaults", async () => {
    const { store, filePath, directory } = await createStore();
    const original = JSON.stringify({
      ...legacyState,
      presentation: { sideOrder: "normal" },
    });
    await writeFile(filePath, original);

    const restored = await store.load(state);
    expect(restored.presentation).toEqual({
      sideOrder: "normal",
      overlayTemplateId: "octagon",
    });
    expect(restored.liveSelection).toEqual(state.liveSelection);
    expect(await readFile(join(directory, (await backups(directory))[0]!), "utf8")).toBe(original);
  });

  it("backs up a legacy file even when the first operation is save", async () => {
    const { store, filePath, directory } = await createStore();
    const original = Buffer.from(JSON.stringify(legacyState));
    await writeFile(filePath, original);
    const next = { ...state, liveSelection: null };

    await store.save(next);
    expect(await readFile(join(directory, (await backups(directory))[0]!))).toEqual(original);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(envelope(next));
    await store.save(state);
    expect(await backups(directory)).toHaveLength(1);
  });

  it("loads the known schema without rewriting or backing up based on app version", async () => {
    const { store, filePath, directory } = await createStore();
    const original = `\n${JSON.stringify(envelope(state, "999.0.0"), null, 4)}\n`;
    await writeFile(filePath, original);

    await expect(store.load(state)).resolves.toEqual(state);
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await backups(directory)).toEqual([]);
    await store.save(state);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(envelope());
    expect(await backups(directory)).toEqual([]);
  });

  it.each([
    "{broken",
    "null",
    "[]",
    '"not an object"',
    "{}",
    JSON.stringify({ ...legacyState, selectedSetId: 5 }),
    JSON.stringify({ ...legacyState, operator: state, appVersion: APP_VERSION }),
    JSON.stringify({ ...envelope(), appVersion: "" }),
    JSON.stringify({ ...envelope(), appVersion: "  " }),
    JSON.stringify({ ...envelope(), appVersion: null }),
    JSON.stringify({ ...envelope(), appVersion: 3 }),
    JSON.stringify({ schemaVersion: 1, operator: state }),
    JSON.stringify({ ...envelope(), operator: null }),
    JSON.stringify({ ...envelope(), operator: legacyState }),
    JSON.stringify({
      ...envelope(),
      operator: { ...state, presentation: { sideOrder: "normal" } },
    }),
    JSON.stringify({ ...envelope(), unexpected: true }),
  ])("preserves malformed state and blocks subsequent saves: %s", async (original) => {
    const { store, filePath, directory } = await createStore();
    await writeFile(filePath, original);

    await expect(store.load(state)).rejects.toThrow(/Persisted operator state/);
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("rejects invalid UTF-8 without replacing bytes", async () => {
    const { store, filePath, directory } = await createStore();
    const original = Buffer.concat([
      Buffer.from('{"providerId":"'),
      Buffer.from([0xff]),
      Buffer.from(`",${JSON.stringify(legacyState).slice(1)}`),
    ]);
    await writeFile(filePath, original);

    await expect(store.load(state)).rejects.toThrow("not valid UTF-8 JSON");
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readFile(filePath)).toEqual(original);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it.each(["1", null, true, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects a non-integer or incorrectly typed schema marker %j before legacy validation",
    async (schemaVersion) => {
      const { store, filePath, directory } = await createStore();
      const original = JSON.stringify({ ...legacyState, schemaVersion });
      await writeFile(filePath, original);
      const parse = vi.spyOn(operatorStateSchema, "safeParse");

      await expect(store.load(state)).rejects.toThrow("invalid schemaVersion");
      expect(parse).not.toHaveBeenCalled();
      await expect(store.save(state)).rejects.toThrow("after a failed restore");
      expect(await readFile(filePath, "utf8")).toBe(original);
      expect(await readdir(directory)).toEqual(["state.json"]);
    },
  );

  it.each([0, -1, 2, 999])(
    "rejects unknown schema %i before validating an operator, and prevents save",
    async (schemaVersion) => {
      const { store, filePath, directory } = await createStore();
      const original = JSON.stringify({
        ...legacyState,
        schemaVersion,
        appVersion: "999.0.0",
        operator: null,
      });
      await writeFile(filePath, original);
      const parse = vi.spyOn(operatorStateSchema, "safeParse");

      await expect(store.load(state)).rejects.toThrow(`schema version ${String(schemaVersion)} is not supported`);
      expect(parse).not.toHaveBeenCalled();
      await expect(store.save(state)).rejects.toThrow("after a failed restore");
      expect(await readFile(filePath, "utf8")).toBe(original);
      expect(await readdir(directory)).toEqual(["state.json"]);
    },
  );

  it.each([
    JSON.stringify({ ...envelope(), schemaVersion: 2 }),
    "{broken",
    JSON.stringify({ ...legacyState, schemaVersion: "1" }),
  ])("inspects existing data before save without a preceding load: %s", async (original) => {
    const { store, filePath, directory } = await createStore();
    await writeFile(filePath, original);

    await expect(store.save(state)).rejects.toThrow(/Persisted operator state/);
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("detects a newer file installed after a successful load", async () => {
    const { store, filePath } = await createStore();
    await store.save(state);
    await store.load(state);
    const original = JSON.stringify({ ...envelope(), schemaVersion: 2 });
    await writeFile(filePath, original);

    await expect(store.save(state)).rejects.toThrow("schema version 2 is not supported");
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  it("requires a successful explicit reload after failed restore, even if the file is removed", async () => {
    const { store, filePath } = await createStore();
    await writeFile(filePath, "{broken");
    await expect(store.load(state)).rejects.toThrow("not valid UTF-8 JSON");
    await rm(filePath);

    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    await expect(store.load(state)).resolves.toEqual(state);
    await store.save(state);
    await expect(store.load(state)).resolves.toEqual(state);
  });

  it("allows saving after a compatible backup is restored and explicitly loaded", async () => {
    const { store, filePath, directory } = await createStore();
    await writeFile(filePath, JSON.stringify({ ...envelope(), schemaVersion: 2 }));
    await expect(store.load(state)).rejects.toThrow("is not supported");
    await writeFile(filePath, JSON.stringify(legacyState));

    await expect(store.load(state)).resolves.toEqual(state);
    await store.save(state);
    expect(await backups(directory)).toHaveLength(1);
  });

  it("rejects invalid runtime state before creating or replacing files", async () => {
    const { store, filePath, directory } = await createStore();
    const invalid = { ...state, providerId: "" };
    await expect(store.save(invalid)).rejects.toThrow("Cannot save invalid operator state");
    expect(await readdir(directory)).toEqual([]);
    await store.save(state);
    const original = await readFile(filePath);

    await expect(store.save(invalid)).rejects.toThrow("Cannot save invalid operator state");
    expect(await readFile(filePath)).toEqual(original);
    await store.save(state);
  });

  it("does not overwrite or remove a colliding pre-migration backup", async () => {
    const { store, filePath, directory } = await createStore();
    const original = JSON.stringify(legacyState);
    await writeFile(filePath, original);
    const id = "00000000-0000-4000-8000-000000000000";
    vi.mocked(randomUUID).mockReturnValue(id);
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const backupPath = `${filePath}.schema-0.1234.${id}.bak`;
    await writeFile(backupPath, "older backup");

    await expect(store.load(state)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readFile(backupPath, "utf8")).toBe("older backup");
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await backups(directory)).toHaveLength(1);
  });

  it("retains every earlier backup when migrating another restored legacy file", async () => {
    const { store, filePath, directory } = await createStore();
    const first = JSON.stringify(legacyState);
    const second = JSON.stringify({ ...legacyState, selectedSetId: "set-6" });
    await writeFile(filePath, first);
    await store.load(state);
    await writeFile(filePath, second);
    await store.load(state);

    const names = await backups(directory);
    expect(names).toHaveLength(2);
    expect(await Promise.all(names.map((name) => readFile(join(directory, name), "utf8"))))
      .toEqual(expect.arrayContaining([first, second]));
  });

  it("leaves a legacy file intact if creating its backup fails", async () => {
    const { store, filePath, directory } = await createStore();
    const original = JSON.stringify(legacyState);
    await writeFile(filePath, original);
    const error = Object.assign(new Error("Backup denied"), { code: "EACCES" });
    vi.mocked(open).mockRejectedValueOnce(error);

    await expect(store.load(state)).rejects.toBe(error);
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["state.json"]);
    expect(rename).not.toHaveBeenCalled();
  });

  it.each(["writeFile", "sync", "close"] as const)(
    "does not migrate when backup %s fails, and cleans up partial bytes",
    async (operation) => {
      const { store, filePath, directory } = await createStore();
      const original = JSON.stringify(legacyState);
      await writeFile(filePath, original);
      const error = new Error(`Backup ${operation} failed`);
      await failNextPrivateWrite(operation, error);

      await expect(store.load(state)).rejects.toBe(error);
      await expect(store.save(state)).rejects.toThrow("after a failed restore");
      expect(await readFile(filePath, "utf8")).toBe(original);
      expect(await readdir(directory)).toEqual(["state.json"]);
      expect(rename).not.toHaveBeenCalled();
    },
  );

  it("retains a completed backup after migration rename fails, and blocks saves", async () => {
    const { store, filePath, directory } = await createStore();
    const original = Buffer.from(JSON.stringify(legacyState));
    await writeFile(filePath, original);
    const error = new Error("Migration rename failed");
    vi.mocked(rename).mockRejectedValueOnce(error);

    await expect(store.load(state)).rejects.toBe(error);
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readFile(filePath)).toEqual(original);
    const names = await backups(directory);
    expect(names).toHaveLength(1);
    expect(await readFile(join(directory, names[0]!))).toEqual(original);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await expect(store.load(state)).resolves.toEqual(state);
    expect(await backups(directory)).toHaveLength(2);
  });

  it.each(["writeFile", "sync", "close"] as const)(
    "preserves the previous saved state and removes partial temporary files after %s fails",
    async (operation) => {
      const { store, filePath, directory } = await createStore();
      await store.save(state);
      const original = await readFile(filePath);
      const error = new Error(`Atomic ${operation} failed`);
      await failNextPrivateWrite(operation, error);

      await expect(store.save({ ...state, liveSelection: null })).rejects.toBe(error);
      expect(await readFile(filePath)).toEqual(original);
      expect(await readdir(directory)).toEqual(["state.json"]);
      await store.save(state);
    },
  );

  it("keeps a colliding temporary file and the existing state unchanged", async () => {
    const { store, filePath } = await createStore();
    await store.save(state);
    const original = await readFile(filePath);
    const id = "00000000-0000-4000-8000-000000000000";
    vi.mocked(randomUUID).mockReturnValue(id);
    const temporaryPath = `${filePath}.${id}.tmp`;
    await writeFile(temporaryPath, "another writer");

    await expect(store.save(state)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(temporaryPath, "utf8")).toBe("another writer");
    expect(await readFile(filePath)).toEqual(original);
  });

  it("cleans up a failed atomic rename without masking the original error", async () => {
    const { store, filePath, directory } = await createStore();
    await store.save(state);
    const original = await readFile(filePath);
    const error = new Error("Rename failed");
    vi.mocked(rename).mockRejectedValueOnce(error);

    await expect(store.save({ ...state, liveSelection: null })).rejects.toBe(error);
    expect(await readFile(filePath)).toEqual(original);
    expect(await readdir(directory)).toEqual(["state.json"]);
    await store.save(state);
  });

  it("does not mask rename failure when temporary file cleanup also fails", async () => {
    const { store, filePath, directory } = await createStore();
    await store.save(state);
    const original = await readFile(filePath);
    const error = new Error("Original rename error");
    vi.mocked(rename).mockRejectedValueOnce(error);
    vi.mocked(rm).mockRejectedValueOnce(new Error("Cleanup failed"));

    await expect(store.save({ ...state, liveSelection: null })).rejects.toBe(error);
    expect(await readFile(filePath)).toEqual(original);
    const remaining = (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
    expect(remaining).toHaveLength(1);
    await expectPrivate(join(directory, remaining[0]!));
  });

  it("does not mask a write failure when close and cleanup also fail", async () => {
    const { store, directory } = await createStore();
    const error = new Error("Original write error");
    const actual = await vi.importActual<typeof FileSystem>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const file = await actual.open(...args);
      const close = file.close.bind(file);
      vi.spyOn(file, "writeFile").mockRejectedValueOnce(error);
      vi.spyOn(file, "close").mockImplementationOnce(async () => {
        await close();
        throw new Error("Close failed");
      });
      return file;
    });
    vi.mocked(rm).mockRejectedValueOnce(new Error("Cleanup failed"));

    await expect(store.save(state)).rejects.toBe(error);
    const remaining = await readdir(directory);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/\.tmp$/);
    await expectPrivate(join(directory, remaining[0]!));
  });

  it("surfaces non-missing read failures instead of defaults, and blocks saves", async () => {
    const { store, directory } = await createStore();
    const error = Object.assign(new Error("Read denied"), { code: "EACCES" });
    vi.mocked(readFile).mockRejectedValueOnce(error);

    await expect(store.load(state)).rejects.toBe(error);
    await expect(store.save(state)).rejects.toThrow("after a failed restore");
    expect(await readdir(directory)).toEqual([]);
  });

  it("serializes a failed restore ahead of a simultaneous save", async () => {
    const { store, filePath, directory } = await createStore();
    const original = JSON.stringify({ ...envelope(), schemaVersion: 2 });
    await writeFile(filePath, original);

    const results = await Promise.allSettled([store.load(state), store.save(state)]);
    expect(results[0]).toMatchObject({ status: "rejected" });
    expect(results[1]).toHaveProperty("status", "rejected");
    expect(results[1]).toHaveProperty("reason.message", expect.stringContaining("after a failed restore"));
    expect(await readFile(filePath, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("serializes repeated saves without temporary collisions or leftover files", async () => {
    const { store, filePath, directory } = await createStore();
    const next = { ...state, selectedSetId: "set-6" };
    await Promise.all([store.save(state), store.save(next)]);

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(envelope(next));
    expect(await readdir(directory)).toEqual(["state.json"]);
  });
});
