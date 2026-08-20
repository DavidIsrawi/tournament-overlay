import { useTournamentSocket } from "../../shared/browser-client.ts";
import {
  isOverlayTemplateId,
  type OverlayTemplateId,
} from "../../shared/overlay-templates.ts";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { overlayTemplateRegistry } from "../registry.ts";
import "./styles.css";

function useStageScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = (): void => {
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return scale;
}

function requestedTemplate(): {
  readonly id: OverlayTemplateId | null;
  readonly invalid: string | null;
} {
  const value = new URLSearchParams(window.location.search).get("template");
  if (value === null) {
    return { id: null, invalid: null };
  }
  return isOverlayTemplateId(value)
    ? { id: value, invalid: null }
    : { id: null, invalid: value };
}

export function OverlayRuntime(): ReactNode {
  const { state, socketStatus, animationEvents } =
    useTournamentSocket("overlay");
  const scale = useStageScale();
  const request = useMemo(requestedTemplate, []);
  const templateId =
    request.id ?? state?.operator.presentation.overlayTemplateId ?? "octagon";
  const Template = useMemo(
    () => lazy(overlayTemplateRegistry[templateId].load),
    [templateId],
  );
  const style = { transform: `scale(${String(scale)})` };

  if (request.invalid !== null) {
    return (
      <div className="stage" style={style}>
        <div className="overlay-runtime-message">
          Unknown overlay template: {request.invalid}
        </div>
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="stage" style={style}>
        <div className="overlay-runtime-message">
          Connecting to tournament server…
        </div>
      </div>
    );
  }

  return (
    <div className="stage" style={style}>
      <Suspense
        fallback={
          <div className="overlay-runtime-message">Loading overlay design…</div>
        }
      >
        <Template
          view={state.overlay}
          connected={socketStatus === "connected"}
          animationEvents={animationEvents}
        />
      </Suspense>
    </div>
  );
}
