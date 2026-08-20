import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OverlayRuntime } from "./runtime/OverlayRuntime.tsx";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Overlay root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <OverlayRuntime />
  </StrictMode>,
);
