export const OVERLAY_TEMPLATE_IDS = ["octagon", "minimal"] as const;

export type OverlayTemplateId = (typeof OVERLAY_TEMPLATE_IDS)[number];

export const OVERLAY_TEMPLATES = [
  {
    id: "octagon",
    name: "Octagon",
    description: "Nautical broadcast plates with animated helm scoring.",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "A compact, distraction-free tournament score ribbon.",
  },
] as const satisfies readonly {
  readonly id: OverlayTemplateId;
  readonly name: string;
  readonly description: string;
}[];

export const DEFAULT_OVERLAY_TEMPLATE_ID: OverlayTemplateId = "octagon";

export function isOverlayTemplateId(
  value: string | null | undefined,
): value is OverlayTemplateId {
  return OVERLAY_TEMPLATES.some((template) => template.id === value);
}
