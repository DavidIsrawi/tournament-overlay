import type { OverlayView } from "../shared/contracts.ts";
import type { OverlayAnimationEvent } from "../shared/overlay-events.ts";

export interface OverlayTemplateProps {
  readonly view: OverlayView;
  readonly connected: boolean;
  readonly animationEvents: readonly OverlayAnimationEvent[];
}
