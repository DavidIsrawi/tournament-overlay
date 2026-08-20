import type { ComponentType } from "react";
import type { OverlayTemplateId } from "../shared/overlay-templates.ts";
import type { OverlayTemplateProps } from "./types.ts";

interface OverlayTemplateModule {
  readonly default: ComponentType<OverlayTemplateProps>;
}

interface OverlayTemplateRegistration {
  readonly load: () => Promise<OverlayTemplateModule>;
}

export const overlayTemplateRegistry: Record<
  OverlayTemplateId,
  OverlayTemplateRegistration
> = {
  octagon: {
    load: () => import("./templates/octagon/OctagonOverlay.tsx"),
  },
  minimal: {
    load: () => import("./templates/minimal/MinimalOverlay.tsx"),
  },
};
