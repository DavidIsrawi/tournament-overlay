import { describe, expect, it } from "vitest";
import {
  mergeCachedPhaseGroups,
  replaceBracketSet,
  replacePhaseGroupSets,
  resolvePhaseGroupSelection,
  resolveSetSelection,
} from "./bracket-data.ts";
import { fixtureEvent, fixtureSet } from "./fixtures.test-support.ts";

function loadedEvent() {
  return replacePhaseGroupSets(fixtureEvent(), "group-1", [
    fixtureSet("group-1-a"),
    fixtureSet("group-1-b"),
  ], true);
}

describe("immutable bracket data", () => {
  it("replaces live set data without changing the cached group freshness or other sets", () => {
    const event = loadedEvent();
    const before = structuredClone(event);
    const updated = fixtureSet("group-1-a", "group-1", 3);
    const result = replaceBracketSet(event, updated);
    expect(event).toEqual(before);
    expect(result.phaseGroups[0]?.sets[0]).toBe(updated);
    expect(result.phaseGroups[0]?.sets[1]).toBe(event.phaseGroups[0]?.sets[1]);
    expect(result.phaseGroups[0]?.setsFetchedAt).toBe(event.phaseGroups[0]?.setsFetchedAt);
    expect(result.phaseGroups[1]).toBe(event.phaseGroups[1]);
  });

  it("only reuses complete phase caches belonging to the same provider and event", () => {
    const cached = loadedEvent();
    const metadata = fixtureEvent();
    expect(mergeCachedPhaseGroups(metadata, cached).phaseGroups[0]?.sets)
      .toBe(cached.phaseGroups[0]?.sets);
    expect(mergeCachedPhaseGroups(metadata, { ...cached, providerId: "another-provider" }))
      .toBe(metadata);
    expect(mergeCachedPhaseGroups(metadata, { ...cached, id: "another-event" }))
      .toBe(metadata);
    const partial = replacePhaseGroupSets(fixtureEvent(), "group-1", [fixtureSet("partial")], false);
    expect(mergeCachedPhaseGroups(metadata, partial)).toEqual(metadata);
  });

  it("preserves cached profiles only for matching entrants when refreshing lightweight sets", () => {
    const set = fixtureSet("group-1-a");
    const first = set.entrants[0]!;
    const detailed = {
      ...set,
      entrants: [
        { ...first, entrant: { ...first.entrant, pronouns: "they/them", prefix: "Team" } },
        set.entrants[1],
      ] as const,
    };
    const cached = replacePhaseGroupSets(fixtureEvent(), "group-1", [detailed], true);
    const before = structuredClone(cached);
    const result = replacePhaseGroupSets(cached, "group-1", [fixtureSet("group-1-a", "group-1", 2)], true);
    expect(cached).toEqual(before);
    expect(result.phaseGroups[0]?.sets[0]?.entrants[0]).toMatchObject({
      score: 2,
      entrant: { pronouns: "they/them", prefix: "Team" },
    });
    const changedEntrant = {
      ...set,
      entrants: [{ ...first, entrant: { ...first.entrant, id: "replacement-player" } }, set.entrants[1]] as const,
    };
    const replacement = replacePhaseGroupSets(cached, "group-1", [changedEntrant], true);
    expect(replacement.phaseGroups[0]?.sets[0]?.entrants[0]?.entrant.pronouns).toBeNull();
  });

  it("preserves a saved selection during pagination and resolves missing selections after loading", () => {
    const metadata = fixtureEvent();
    expect(resolvePhaseGroupSelection(metadata, "missing")).toBe("group-1");
    expect(resolvePhaseGroupSelection(metadata, "group-2")).toBe("group-2");
    expect(resolveSetSelection(metadata, "group-1", "saved")).toBe("saved");
    expect(resolveSetSelection(loadedEvent(), "group-1", "saved")).toBe("group-1-a");
    expect(resolveSetSelection(loadedEvent(), "group-1", "group-1-b")).toBe("group-1-b");
    expect(resolveSetSelection(metadata, "missing", "saved")).toBeNull();
  });
});
