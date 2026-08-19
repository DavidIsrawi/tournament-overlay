import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OverlayApp } from "./OverlayApp.tsx";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Overlay root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
