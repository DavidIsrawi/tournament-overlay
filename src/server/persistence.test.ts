import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AtomicOperatorStateStore } from "./persistence.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AtomicOperatorStateStore", () => {
  it("restores the last persisted operator scene", async () => {
    const directory = await mkdtemp(join(tmpdir(), "overlay-state-"));
    directories.push(directory);
    const store = new AtomicOperatorStateStore(join(directory, "state.json"));
    const state = {
      providerId: "startgg",
      eventInput: "genesis-9/event/melee-singles",
      selectedPhaseGroupId: "top-8",
      selectedSetId: "set-5",
      presentation: { sideOrder: "swapped" as const },
    };

    await store.save(state);
    const restored = await store.load({
      ...state,
      selectedSetId: null,
      presentation: { sideOrder: "normal" },
    });

    expect(restored).toEqual(state);
  });
});
