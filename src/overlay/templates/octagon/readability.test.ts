import { describe, expect, it } from "vitest";
import type { OverlayPlayer } from "../../../shared/contracts.ts";
import { DEFAULT_OVERLAY_METADATA_FIELDS } from "../../../shared/overlay-metadata.ts";
import { abbreviateRoundName, fitMetadataChips, fitPlayerName, selectMetadataChips } from "./readability.ts";

const player: OverlayPlayer = {
  sourceEntrantId: "entrant",
  displayName: "Captain",
  prefix: "An exceptionally long sponsor",
  score: 2,
  seed: 128,
  pronouns: "they/them",
  social: "@captain",
  location: "A very long state name",
  country: "United States",
  isWinner: false,
};

describe("broadcast round names", () => {
  it.each([
    ["Winners Quarter-Final", "Winners QF"],
    ["Winners Quarterfinals", "Winners QF"],
    ["Winner Quarter Finals", "Winners QF"],
    ["Losers Quarter-Finals", "Losers QF"],
    ["Winners Semi-Final", "Winners SF"],
    ["Losers Semifinals", "Losers SF"],
    ["Loser Semi Finals", "Losers SF"],
    ["Winners Final", "Winners Final"],
    ["Losers Finals", "Losers Final"],
    ["Grand Finals", "Grand Final"],
    ["grand final", "Grand Final"],
    ["Grand Finals Reset", "Grand Final Reset"],
    ["Grand Finals (Reset)", "Grand Final Reset"],
  ])("deliberately abbreviates %s", (input, expected) => {
    expect(abbreviateRoundName(input)).toBe(expected);
  });

  it.each([
    "Winners Round 2",
    "Invitational Championship Deciding Match",
    "Winners Quarter-Final · Pool A",
    "決勝トーナメント ⚓",
    "  Custom round  ",
    "",
  ])("preserves unfamiliar round text: %s", (input) => {
    expect(abbreviateRoundName(input)).toBe(input);
  });
});

describe("selected metadata content", () => {
  it("defaults to complete seed and pronouns, with no redundant pronouns label", () => {
    expect(selectMetadataChips(player, DEFAULT_OVERLAY_METADATA_FIELDS)).toEqual([
      { field: "seed", label: "Seed", value: "128", flag: null, flagLabel: null },
      { field: "pronouns", label: null, value: "they/them", flag: null, flagLabel: null },
    ]);
  });

  it("keeps the selected order, at most two unique fields, without substituting unselected details", () => {
    expect(selectMetadataChips(player, ["social", "social", "country", "seed"]).map((chip) => chip.field))
      .toEqual(["social", "country"]);
    expect(selectMetadataChips({ ...player, social: null }, ["social", "seed", "pronouns"]).map((chip) => chip.field))
      .toEqual(["seed"]);
  });

  it("keeps one identifying @ marker without a separate label", () => {
    for (const social of ["captain", "@captain", " @captain "]) {
      expect(selectMetadataChips({ ...player, social }, ["social"])[0])
        .toMatchObject({ value: "@captain", label: null });
    }
  });

  it("uses a compact country code and accessible flag, never the location/state", () => {
    expect(selectMetadataChips(player, ["country"])).toEqual([{
      field: "country",
      label: null,
      value: "US",
      flag: "🇺🇸",
      flagLabel: "United States flag",
    }]);
    expect(selectMetadataChips({ ...player, country: "uk" }, ["country"])[0])
      .toMatchObject({ value: "GB", flag: "🇬🇧" });
  });

  it("omits absent, blank, unknown-country, and disabled details", () => {
    expect(selectMetadataChips(null, DEFAULT_OVERLAY_METADATA_FIELDS)).toEqual([]);
    expect(selectMetadataChips(player, [])).toEqual([]);
    expect(selectMetadataChips({ ...player, pronouns: "  ", social: "@" }, ["pronouns", "social"])).toEqual([]);
    expect(selectMetadataChips({ ...player, seed: null, country: "Atlantis" }, ["seed", "country"])).toEqual([]);
  });

  it("preserves complete Unicode values and numeric zero", () => {
    expect(selectMetadataChips({ ...player, seed: 0, pronouns: "彼 / 彼ら ⚓" }, DEFAULT_OVERLAY_METADATA_FIELDS)
      .map((chip) => chip.value)).toEqual(["0", "彼 / 彼ら ⚓"]);
  });
});

describe("whole-chip fitting", () => {
  const chips = selectMetadataChips(player, DEFAULT_OVERLAY_METADATA_FIELDS);

  it("fits the full default values, including a three-digit seed", () => {
    expect(fitMetadataChips(chips, [100, 112], 452)).toEqual(chips);
  });

  it("includes an exact fit and omits the optional chip one pixel below the boundary", () => {
    expect(fitMetadataChips(chips, [100, 112], 218)).toEqual(chips);
    expect(fitMetadataChips(chips, [100, 112], 217)).toEqual([chips[0]]);
  });

  it("omits oversized pronouns or social whole, rather than clipping the value or seed", () => {
    const oversizedPronouns = selectMetadataChips({ ...player, pronouns: "they/them ".repeat(30) }, DEFAULT_OVERLAY_METADATA_FIELDS);
    expect(fitMetadataChips(oversizedPronouns, [100, 2_000], 452)).toEqual([oversizedPronouns[0]]);
    const socialFirst = selectMetadataChips(player, ["social", "seed"]);
    expect(fitMetadataChips(socialFirst, [400, 100], 452)).toEqual([socialFirst[1]]);
  });

  it("returns selected order even when seed is reserved first", () => {
    const reversed = selectMetadataChips(player, ["pronouns", "seed"]);
    expect(fitMetadataChips(reversed, [112, 100], 452)).toEqual(reversed);
  });

  it("does not leave a gap for an omitted chip, and recomputes as space changes", () => {
    const selection = selectMetadataChips(player, ["social", "country"]);
    expect(fitMetadataChips(selection, [800, 75], 75)).toEqual([selection[1]]);
    expect(fitMetadataChips(selection, [800, 75], 881)).toEqual(selection);
    expect(fitMetadataChips(selection, [800, 75], 74)).toEqual([]);
  });

  it("does not show unmeasured, invalid, or zero-width content", () => {
    expect(fitMetadataChips(chips, [], 452)).toEqual([]);
    expect(fitMetadataChips(chips, [NaN, 0], 452)).toEqual([]);
    expect(fitMetadataChips(chips, [100, 112], -1)).toEqual([]);
  });
});

describe("name-first fitting", () => {
  it("keeps the normal 31px name and full prefix when both fit", () => {
    expect(fitPlayerName(382, () => 200, 50))
      .toEqual({ fontSize: 31, prefixWidth: 50, ellipsized: false });
  });

  it("truncates the sponsor's allocation before reducing the name", () => {
    expect(fitPlayerName(382, () => 300, 900))
      .toEqual({ fontSize: 31, prefixWidth: 72, ellipsized: false });
  });

  it("hides a sponsor that would only leave an unreadable fragment", () => {
    expect(fitPlayerName(382, () => 350, 900))
      .toEqual({ fontSize: 31, prefixWidth: 0, ellipsized: false });
  });

  it("fits a longer name only after the sponsor has yielded its space", () => {
    expect(fitPlayerName(382, (size) => size * 15, 900))
      .toEqual({ fontSize: 25, prefixWidth: 0, ellipsized: false });
  });

  it("stops at the readable 23px floor, using ellipsis only for extreme names", () => {
    expect(fitPlayerName(382, (size) => size * 30, 900))
      .toEqual({ fontSize: 23, prefixWidth: 0, ellipsized: true });
  });

  it("uses measured glyph widths rather than text length assumptions", () => {
    expect(fitPlayerName(382, (size) => size * 8 + 50, 0))
      .toEqual({ fontSize: 31, prefixWidth: 0, ellipsized: false });
    expect(fitPlayerName(382, (size) => size * 15 + 30, 0))
      .toEqual({ fontSize: 23, prefixWidth: 0, ellipsized: false });
  });
});
