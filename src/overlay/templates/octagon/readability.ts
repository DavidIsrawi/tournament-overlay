import type { OverlayPlayer } from "../../../shared/contracts.ts";
import { countryFlagEmoji } from "../../../shared/country-flags.ts";
import type { OverlayMetadataField } from "../../../shared/overlay-metadata.ts";

export interface MetadataChip {
  readonly field: OverlayMetadataField;
  readonly value: string;
  readonly label: string | null;
  readonly flag: string | null;
  readonly flagLabel: string | null;
}

export function selectMetadataChips(
  player: OverlayPlayer | null,
  fields: readonly OverlayMetadataField[],
): MetadataChip[] {
  if (player === null) {
    return [];
  }

  return [...new Set(fields)].slice(0, 2).flatMap((field): MetadataChip[] => {
    const chip = { field, label: null, flag: null, flagLabel: null };
    switch (field) {
      case "seed":
        return player.seed === null
          ? []
          : [{ ...chip, label: "Seed", value: String(player.seed) }];
      case "pronouns": {
        const value = player.pronouns?.trim();
        return value ? [{ ...chip, value }] : [];
      }
      case "social": {
        const value = player.social?.trim();
        return value && value !== "@"
          ? [{ ...chip, value: value.startsWith("@") ? value : `@${value}` }]
          : [];
      }
      case "country": {
        const flag = countryFlagEmoji(player.country);
        return flag === null ? [] : [{
          ...chip,
          flag,
          flagLabel: `${player.country?.trim() ?? "Country"} flag`,
          value: Array.from(flag, (character) =>
            String.fromCharCode((character.codePointAt(0) ?? 0) - 0x1f1e6 + 65),
          ).join(""),
        }];
      }
    }
  });
}

export function fitMetadataChips(
  chips: readonly MetadataChip[],
  widths: readonly number[],
  availableWidth: number,
  gap = 6,
): MetadataChip[] {
  const included = new Set<MetadataChip>();
  let remaining = Math.max(0, availableWidth);
  // Reserve the complete seed before considering optional profile details.
  const order = chips.map((chip, index) => ({ chip, index })).sort(
    (left, right) => Number(right.chip.field === "seed") - Number(left.chip.field === "seed"),
  );
  for (const { chip, index } of order) {
    const width = widths[index];
    if (width === undefined || !Number.isFinite(width) || width <= 0) {
      continue;
    }
    const required = width + (included.size > 0 ? gap : 0);
    if (required <= remaining) {
      included.add(chip);
      remaining -= required;
    }
  }
  return chips.filter((chip) => included.has(chip));
}

export interface PlayerNameLayout {
  readonly fontSize: number;
  readonly prefixWidth: number;
  readonly ellipsized: boolean;
}

export function fitPlayerName(
  availableWidth: number,
  measureName: (fontSize: number) => number,
  naturalPrefixWidth: number,
): PlayerNameLayout {
  const width = Math.max(0, availableWidth);
  let fontSize = 31;
  let nameWidth = measureName(fontSize);
  while (nameWidth > width && fontSize > 23) {
    fontSize -= 1;
    nameWidth = measureName(fontSize);
  }
  const remaining = Math.max(0, width - nameWidth - 10);
  const prefixWidth = Math.min(naturalPrefixWidth, remaining);
  return {
    fontSize,
    prefixWidth: prefixWidth >= Math.min(naturalPrefixWidth, 36) ? prefixWidth : 0,
    ellipsized: nameWidth > width,
  };
}

export function abbreviateRoundName(name: string): string {
  const bracket = /^(winners?|losers?)\s+(quarter[\s-]?finals?|semi[\s-]?finals?|finals?)$/i.exec(name.trim());
  if (bracket !== null) {
    const side = bracket[1]?.toLowerCase().startsWith("winner") ? "Winners" : "Losers";
    const stage = bracket[2]?.toLowerCase();
    return `${side} ${stage?.startsWith("quarter") ? "QF" : stage?.startsWith("semi") ? "SF" : "Final"}`;
  }
  if (/^grand\s+finals?$/i.test(name.trim())) {
    return "Grand Final";
  }
  if (/^grand\s+finals?\s+(?:reset|\(reset\))$/i.test(name.trim())) {
    return "Grand Final Reset";
  }
  return name;
}
