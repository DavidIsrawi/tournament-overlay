import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./app-info.ts";
import { PROTOCOL_VERSION } from "./contracts.ts";
import { reloadMessage, snapshotNeedsReload, versionsMatch } from "./compatibility.ts";

describe("application compatibility", () => {
  it("requires both the application and protocol version to match", () => {
    expect(versionsMatch(APP_VERSION, PROTOCOL_VERSION)).toBe(true);
    expect(versionsMatch("0.0.1", PROTOCOL_VERSION)).toBe(false);
    expect(versionsMatch(APP_VERSION, PROTOCOL_VERSION - 1)).toBe(false);
    expect(versionsMatch(undefined, PROTOCOL_VERSION)).toBe(false);
  });

  it("recognizes old and future snapshots before strict protocol decoding", () => {
    expect(snapshotNeedsReload({
      type: "state.snapshot",
      state: { protocolVersion: PROTOCOL_VERSION - 1 },
    })).toBe(true);
    expect(snapshotNeedsReload({
      type: "state.snapshot",
      state: { appVersion: APP_VERSION, protocolVersion: PROTOCOL_VERSION + 1 },
    })).toBe(true);
    expect(snapshotNeedsReload({
      type: "state.snapshot",
      state: { appVersion: APP_VERSION, protocolVersion: PROTOCOL_VERSION },
    })).toBe(false);
    expect(snapshotNeedsReload({ type: "command.ack", commandId: "one" })).toBe(false);
  });

  it("gives each client its appropriate manual recovery action", () => {
    expect(reloadMessage("dashboard")).toContain("Reload this dashboard");
    expect(reloadMessage("overlay")).toContain("Refresh this browser source in OBS");
  });
});
