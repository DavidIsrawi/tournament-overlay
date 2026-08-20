import type { OverlayView } from "../shared/contracts.ts";

export interface OverlayTemplateProps {
  readonly view: OverlayView;
  readonly connected: boolean;
}
