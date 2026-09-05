import { describe, expect, it } from "vitest";
import { CommandTracker } from "./command-tracker.ts";

describe("CommandTracker", () => {
  it("tracks pending commands until their own completion and ignores unknown acknowledgments", () => {
    const tracker = new CommandTracker();
    tracker.begin("swap", { type: "presentation.swap" });
    tracker.begin("refresh", { type: "refresh" });
    tracker.acknowledge("unknown");
    tracker.acknowledge("swap");
    expect(tracker.pending).toEqual([{ commandId: "refresh", type: "refresh" }]);
  });

  it("prevents repeated non-idempotent actions but allows superseding phase selection", () => {
    const tracker = new CommandTracker();
    expect(tracker.begin("swap", { type: "presentation.swap" })).toBe(true);
    expect(tracker.begin("swap-again", { type: "presentation.swap" })).toBe(false);
    expect(tracker.begin("phase-1", { type: "phase.select", phaseGroupId: "one" })).toBe(true);
    expect(tracker.begin("phase-2", { type: "phase.select", phaseGroupId: "two" })).toBe(true);
  });

  it("does not clear a failure when an unrelated command completes", () => {
    const tracker = new CommandTracker();
    tracker.begin("refresh", { type: "refresh" });
    tracker.begin("swap", { type: "presentation.swap" });
    tracker.fail("refresh", "Provider offline");
    tracker.acknowledge("swap");
    expect(tracker.error).toBe("Provider offline");
    tracker.begin("retry", { type: "refresh" });
    tracker.acknowledge("retry");
    expect(tracker.error).toBeNull();
    expect(tracker.pending).toEqual([]);
  });

  it("clears pending actions on disconnect without replaying or falsely confirming them", () => {
    const tracker = new CommandTracker();
    tracker.begin("swap", { type: "presentation.swap" });
    tracker.disconnect();
    expect(tracker.pending).toEqual([]);
    expect(tracker.error).toContain("before confirmation");
    tracker.acknowledge("swap");
    expect(tracker.error).toContain("before confirmation");
    tracker.dismissError();
    expect(tracker.error).toBeNull();
  });

  it("clears a recovered bracket failure but not an unrelated live action failure", () => {
    const tracker = new CommandTracker();
    tracker.begin("refresh", { type: "refresh" });
    tracker.fail("refresh", "Offline");
    tracker.reconcileBracket("stale");
    expect(tracker.error).toBe("Offline");
    tracker.reconcileBracket("fresh");
    expect(tracker.error).toBeNull();
    tracker.begin("take", { type: "live.take", eventId: "event", setId: "set" });
    tracker.fail("take", "Cannot load the next set");
    tracker.reconcileBracket("fresh");
    expect(tracker.error).toBe("Cannot load the next set");
  });
});
