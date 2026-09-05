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

  it("orders losers rounds by bracket progression rather than signed values", () => {
    const losers = [
      set("L3", "Losers Final", -3, "pending", "Ada", "Grace"),
      set("L1", "Losers Round 1", -1, "active", "Linus", "Margaret"),
      set("L2", "Losers Round 2", -2, "pending", "Barbara", "Ken"),
    ];

    expect(buildVisibleRounds(losers, "", "pending").map(({ order }) => order)).toEqual([-1, -2, -3]);
  });

  it("keeps ascending winners rounds before progressing losers rounds in mixed brackets", () => {
    const mixed = [
      set("L2", "Losers Final", -2, "pending", "Ada", "Grace"),
      set("W3", "Grand Final", 3, "pending", "Linus", "Margaret"),
      set("L1", "Losers Round 1", -1, "pending", "Barbara", "Ken"),
      set("W1", "Winners Round 1", 1, "pending", "Ada", "Grace"),
      set("W2", "Winners Final", 2, "pending", "Linus", "Margaret"),
      set("R0", "Unassigned Round", 0, "pending", "Barbara", "Ken"),
    ];

    const expected = [0, 1, 2, 3, -1, -2];
    expect(buildVisibleRounds(mixed, "", "pending").map(({ order }) => order)).toEqual(expected);
    expect(buildVisibleRounds([...mixed].reverse(), "", "pending").map(({ order }) => order)).toEqual(expected);
  });

  it("breaks equal-order round ties deterministically by name within each bracket", () => {
    const tied = [
      set("WB", "Winners B", 1, "pending", "Ada", "Grace"),
      set("LB", "Losers B", -1, "pending", "Linus", "Margaret"),
      set("LA", "Losers A", -1, "pending", "Barbara", "Ken"),
      set("WA", "Winners A", 1, "pending", "Ada", "Grace"),
    ];

    const expected = ["Winners A", "Winners B", "Losers A", "Losers B"];
    expect(buildVisibleRounds(tied, "", "pending").map(({ name }) => name)).toEqual(expected);
    expect(buildVisibleRounds([...tied].reverse(), "", "pending").map(({ name }) => name)).toEqual(expected);
  });

  it("preserves search and state filters when ordering negative and mixed rounds", () => {
    const mixed = [
      set("L3", "Losers Final", -3, "completed", "Ada", "Grace"),
      set("L2", "Losers Round 2", -2, "pending", "Ada", "Grace"),
      set("W2", "Winners Final", 2, "active", "Ada", "Linus"),
      set("L1", "Losers Round 1", -1, "active", "Ada", "Margaret"),
      set("W1", "Winners Round 1", 1, "pending", "Barbara", "Ken"),
      set("L0", "Losers Round 1", -1, "completed", "Ada", "Ken"),
    ];

    expect(buildVisibleRounds(mixed, " ADA ", "pending").map(({ order }) => order)).toEqual([2, -1, -2]);
    expect(buildVisibleRounds(mixed, " ADA ", "completed").map(({ order }) => order)).toEqual([-1, -3]);
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
