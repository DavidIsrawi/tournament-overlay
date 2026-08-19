import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  deriveOverlayView,
  type ServerState,
} from "../shared/contracts.ts";
import { StateHub } from "./state-hub.ts";

function makeState(revision: number): ServerState {
  const connection = {
    status: "idle" as const,
    message: null,
    lastUpdatedAt: null,
    nextPollAt: null,
    failureCount: 0,
  };
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision,
    startedAt: "2026-08-19T00:00:00.000Z",
    providers: [],
    operator: {
      providerId: "demo",
      eventInput: "demo/octagon-open",
      selectedPhaseGroupId: null,
      selectedSetId: null,
      presentation: { sideOrder: "normal" },
    },
    connection,
    event: null,
    overlay: deriveOverlayView(
      revision,
      null,
      null,
      { sideOrder: "normal" },
      "idle",
    ),
  };
}

describe("StateHub", () => {
  it("sends an initial snapshot and all later revisions to subscribers", () => {
    const revisions: number[] = [];
    const hub = new StateHub(makeState(0));
    const unsubscribe = hub.subscribe((state) => {
      revisions.push(state.revision);
    });

    hub.publish(makeState(1));
    unsubscribe();
    hub.publish(makeState(2));

    expect(revisions).toEqual([0, 1]);
  });
});
