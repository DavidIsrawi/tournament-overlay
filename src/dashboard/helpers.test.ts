import { describe, expect, it } from "vitest";
import type {
  ConnectionState,
  NormalizedSet,
  NormalizedSetState,
} from "../shared/contracts.ts";
import {
  buildVisibleRounds,
  connectionNotice,
} from "./helpers.ts";

function set(
  identifier: string,
  roundName: string,
  roundOrder: number,
  state: NormalizedSetState,
  leftName: string,
  rightName: string,
): NormalizedSet {
  const entrant = (id: string, name: string) => ({
    id,
    name,
    prefix: null,
    seed: null,
    pronouns: null,
    social: null,
    location: null,
  });

  return {
    id: identifier,
    identifier,
    phaseGroupId: "group-1",
    phaseName: "Top 8",
    round: { name: roundName, order: roundOrder },
    state,
    winnerId: null,
    entrants: [
      { entrant: entrant(`${identifier}-left`, leftName), score: null },
      { entrant: entrant(`${identifier}-right`, rightName), score: null },
    ],
  };
}

function connection(
  status: ConnectionState["status"],
  message: string | null,
): ConnectionState {
  return {
    status,
    message,
    lastUpdatedAt: null,
    nextPollAt: null,
    failureCount: 0,
  };
}

describe("buildVisibleRounds", () => {
  const sets = [
    set("B1", "Grand Final", 2, "completed", "Ada", "Grace"),
    set("A1", "Winners Final", 1, "pending", "Linus", "Margaret"),
    set("A2", "Winners Final", 1, "active", "Barbara", "Ken"),
  ];

  it("filters by state and groups sets in round order", () => {
    expect(buildVisibleRounds(sets, "", "pending")).toEqual([
      {
        name: "Winners Final",
        order: 1,
        sets: [sets[1], sets[2]],
      },
    ]);
  });

  it("searches entrant names without case sensitivity", () => {
    expect(buildVisibleRounds(sets, "grace", "completed")).toEqual([
      {
        name: "Grand Final",
        order: 2,
        sets: [sets[0]],
      },
    ]);
  });
});

describe("connectionNotice", () => {
  it("derives provider error presentation", () => {
    expect(connectionNotice(connection("error", "Request failed"), null)).toEqual(
      {
        canRetry: true,
        message: "Request failed",
        title: "Provider needs attention",
        tone: "bad",
        variant: "error",
      },
    );
  });

  it("uses socket errors when the provider has no message", () => {
    expect(
      connectionNotice(connection("fresh", null), "Socket disconnected"),
    ).toMatchObject({
      message: "Socket disconnected",
      tone: "good",
      variant: "warning",
    });
  });
});
