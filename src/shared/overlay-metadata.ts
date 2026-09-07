export const OVERLAY_METADATA_FIELDS = ["seed", "pronouns", "country", "social"] as const;

export type OverlayMetadataField = (typeof OVERLAY_METADATA_FIELDS)[number];

export const DEFAULT_OVERLAY_METADATA_FIELDS: readonly OverlayMetadataField[] = ["seed", "pronouns"];

export const OVERLAY_METADATA_LABELS: Record<OverlayMetadataField, string> = {
  seed: "Seed",
  pronouns: "Pronouns",
  country: "Country",
  social: "Social handle",
};
