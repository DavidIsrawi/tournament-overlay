import { describe, expect, it } from "vitest";
import {
  deriveOverlayView,
  clientCommandSchema,
  operatorStateSchema,
  presentationStateSchema,
  type NormalizedEvent,
  type NormalizedSet,
} from "./contracts.ts";
import { DEFAULT_OVERLAY_METADATA_FIELDS, OVERLAY_METADATA_FIELDS } from "./overlay-metadata.ts";

const set: NormalizedSet = {
  id: "set-1",
  identifier: "A1",
  phaseGroupId: "group-1",
  phaseName: "Top 8",
  round: { name: "Winners Final", order: 1 },
  state: "active",
  winnerId: null,
  entrants: [
    {
      entrant: {
        id: "p1",
        name: "Port",
        prefix: "PNW",
        seed: 1,
        pronouns: "he/him",
        social: "@port",
        location: { state: "WA", country: "US" },
      },
      score: 2,
    },
    {
      entrant: {
        id: "p2",
        name: "Starboard",
        prefix: null,
        seed: 2,
        pronouns: "she/her",
        social: null,
        location: null,
      },
      score: 1,
    },
  ],
};

const event: NormalizedEvent = {
  id: "event-1",
  providerId: "startgg",
  slug: "genesis-9/event/melee-singles",
  name: "Ultimate Singles",
  tournamentName: "Octagon Open",
  phaseGroups: [
    {
      id: "group-1",
      name: "Top 8",
      phaseName: "Top 8",
      setsLoaded: true,
      setsFetchedAt: "2026-08-19T00:00:00.000Z",
      sets: [set],
    },
  ],
  fetchedAt: "2026-08-19T00:00:00.000Z",
};

describe("deriveOverlayView", () => {
  it("swaps presentation sides without mutating normalized source data", () => {
    const originalFirst = set.entrants[0];
    const view = deriveOverlayView(
      4,
      event,
      set,
      presentationStateSchema.parse({ sideOrder: "swapped" }),
      "fresh",
    );

    expect(view.players[0]?.sourceEntrantId).toBe("p2");
    expect(view.players[1]?.sourceEntrantId).toBe("p1");
    expect(view.players[1]?.country).toBe("US");
    expect(view.players[1]?.location).toBe("WA");
    expect(set.entrants[0]).toBe(originalFirst);
    expect(set.entrants[0]?.entrant.id).toBe("p1");
  });

  it("defaults older persisted scenes to the Octagon template", () => {
    const parsed = operatorStateSchema.parse({
      providerId: "startgg",
      eventInput: "",
      selectedPhaseGroupId: null,
      selectedSetId: null,
      presentation: { sideOrder: "normal" },
    });

    expect(parsed.presentation.overlayTemplateId).toBe("octagon");
    expect(parsed.presentation.metadataFields).toEqual(DEFAULT_OVERLAY_METADATA_FIELDS);
    expect(parsed.presentation.overlayVisible).toBe(true);
    expect(parsed.previousLiveSelection).toBeNull();
  });

  it("migrates legacy live selections but preserves an explicit empty live scene", () => {
    const legacy = {
      providerId: "startgg",
      eventInput: "tournament/example/event/singles",
      selectedPhaseGroupId: "group-1",
      selectedSetId: "set-1",
      presentation: { sideOrder: "normal" },
    };
    expect(operatorStateSchema.parse(legacy).liveSelection).toEqual({
      providerId: "startgg",
      eventInput: legacy.eventInput,
      phaseGroupId: "group-1",
      setId: "set-1",
    });
    expect(operatorStateSchema.parse({ ...legacy, liveSelection: null }).liveSelection).toBeNull();
  });
});

describe("live presentation contracts", () => {
  it.each([
    [],
    ...OVERLAY_METADATA_FIELDS.map((field) => [field]),
    ["country", "social"],
    ["pronouns", "seed"],
  ].map((fields) => ({ fields })))("accepts an ordered selection of up to two metadata fields: %j", ({ fields }) => {
    const command = { type: "presentation.metadata", fields };
    expect(clientCommandSchema.parse(command)).toEqual(command);
  });

  it.each([
    { fields: ["seed", "seed"] },
    { fields: ["seed", "pronouns", "country"] },
    { fields: ["location"] },
    { fields: ["SEED"] },
    { fields: null },
    { fields: "seed" },
    {},
  ])("rejects invalid metadata commands and persisted fields: %j", (input) => {
    expect(clientCommandSchema.safeParse({ type: "presentation.metadata", ...input }).success).toBe(false);
    if ("fields" in input) {
      expect(presentationStateSchema.safeParse({ sideOrder: "normal", metadataFields: input.fields }).success).toBe(false);
    }
  });

  it("keeps an explicit empty metadata selection and hidden presentation", () => {
    const presentation = presentationStateSchema.parse({
      sideOrder: "normal",
      metadataFields: [],
      overlayVisible: false,
    });
    expect(presentation.metadataFields).toEqual([]);
    expect(presentation.overlayVisible).toBe(false);
    expect(deriveOverlayView(1, event, set, presentation, "fresh").metadataFields).toEqual([]);
    const configured = { ...presentation, metadataFields: ["country", "social"] as const };
    expect(deriveOverlayView(2, event, set, configured, "fresh").metadataFields).toEqual(["country", "social"]);
    expect(deriveOverlayView(3, null, null, configured, "idle").metadataFields).toEqual(["country", "social"]);
  });

  it("validates hide, show and previous-live commands", () => {
    expect(clientCommandSchema.parse({ type: "live.restore" })).toEqual({ type: "live.restore" });
    for (const visible of [true, false]) {
      expect(clientCommandSchema.parse({ type: "overlay.visibility", visible })).toEqual({ type: "overlay.visibility", visible });
    }
    expect(clientCommandSchema.safeParse({ type: "overlay.visibility", visible: "false" }).success).toBe(false);
  });
});
