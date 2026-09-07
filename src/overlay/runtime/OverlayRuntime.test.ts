import { PassThrough } from "node:stream";
import { createElement, type ComponentType } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../dashboard/App.tsx";
import { ProviderRegistry } from "../../providers/index.ts";
import { fixtureEvent, fixtureProvider, fixtureSet, MemoryOperatorStore } from "../../server/fixtures.test-support.ts";
import { TournamentService } from "../../server/service.ts";
import { useTournamentSocket } from "../../shared/browser-client.ts";
import { deriveOverlayView, type ServerState } from "../../shared/contracts.ts";
import { OVERLAY_TEMPLATE_IDS, type OverlayTemplateId } from "../../shared/overlay-templates.ts";
import { OverlayRuntime } from "./OverlayRuntime.tsx";

vi.mock("../../shared/browser-client.ts", () => ({
  useTournamentSocket: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("window", { location: { search: "" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function socketState(state: ServerState | null, upgradeRequired: boolean): void {
  vi.mocked(useTournamentSocket).mockReturnValue({
    state,
    socketStatus: "disconnected",
    error: null,
    animationEvents: [],
    pendingCommands: [],
    upgradeRequired,
    sendCommand: vi.fn(() => false),
    dismissError: vi.fn(),
  });
}

function retainedScene(templateId: OverlayTemplateId): ServerState {
  const service = new TournamentService(new ProviderRegistry([fixtureProvider()]), new MemoryOperatorStore(), 60_000);
  const state = service.getState();
  service.close();
  const presentation = { ...state.operator.presentation, overlayTemplateId: templateId };
  return {
    ...state,
    operator: { ...state.operator, presentation },
    overlay: deriveOverlayView(1, fixtureEvent(), fixtureSet("match-one"), presentation, "fresh"),
  };
}

function render(component: ComponentType): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    let html = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => { html += chunk; });
    output.on("end", () => resolve(html));
    output.on("error", reject);
    const stream = renderToPipeableStream(createElement(component), {
      onAllReady() { stream.pipe(output); },
      onError: reject,
    });
  });
}

describe("operator-only upgrade instructions", () => {
  it("keeps an incompatible overlay with no previous scene transparent", async () => {
    socketState(null, true);
    expect(await render(OverlayRuntime)).toBe("");
  });

  it.each(OVERLAY_TEMPLATE_IDS)("preserves the retained %s scoreboard without adding an upgrade notice", async (templateId) => {
    const state = retainedScene(templateId);
    socketState(state, false);
    const before = await render(OverlayRuntime);
    socketState(state, true);
    const after = await render(OverlayRuntime);
    expect(after).toBe(before);
    expect(after).toContain("match-one Player 1");
    expect(after).not.toContain("overlay-runtime-message");
    expect(after).not.toContain("Application updated");
    expect(after).not.toContain("Refresh this browser source");
  });

  it("preserves the ordinary initial connection message", async () => {
    socketState(null, false);
    expect(await render(OverlayRuntime)).toContain("Connecting to tournament server");
  });

  it("keeps dashboard and OBS refresh instructions in the operator dashboard", async () => {
    socketState(null, true);
    const html = await render(App);
    expect(html).toContain("Application updated");
    expect(html).toContain("Reload dashboard");
    expect(html).toContain("refresh the OBS browser source");
  });
});

describe("hidden broadcast output", () => {
  it.each(OVERLAY_TEMPLATE_IDS)("renders no markup for a hidden %s scene, including when disconnected", async (templateId) => {
    const state = retainedScene(templateId);
    socketState({
      ...state,
      operator: {
        ...state.operator,
        presentation: { ...state.operator.presentation, overlayVisible: false },
      },
    }, false);
    expect(await render(OverlayRuntime)).toBe("");
  });

  it("stays transparent even with an invalid pinned template or an upgrade notice", async () => {
    vi.stubGlobal("window", { location: { search: "?template=invalid" } });
    const state = retainedScene("octagon");
    socketState({
      ...state,
      operator: {
        ...state.operator,
        presentation: { ...state.operator.presentation, overlayVisible: false },
      },
    }, true);
    expect(await render(OverlayRuntime)).toBe("");
  });

  it("renders the retained scoreboard again when explicitly shown", async () => {
    const state = retainedScene("minimal");
    socketState(state, false);
    expect(await render(OverlayRuntime)).toContain("match-one Player 1");
  });
});
