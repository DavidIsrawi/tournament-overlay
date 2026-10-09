import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../providers/index.ts";
import { MemoryOperatorStore, fixtureEvent, fixtureProvider, fixtureSet } from "../../server/fixtures.test-support.ts";
import { TournamentService } from "../../server/service.ts";
import { deriveOverlayView, type ServerState } from "../../shared/contracts.ts";
import type { PendingCommand } from "../../shared/command-tracker.ts";
import { useTournamentSocket } from "../../shared/browser-client.ts";
import { App } from "../App.tsx";
import { SceneRail } from "./SceneRail.tsx";

vi.mock("../../shared/browser-client.ts", () => ({
  useTournamentSocket: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("window", { location: { protocol: "http:", hostname: "localhost", origin: "http://localhost:3100" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function scene(): ServerState {
  const service = new TournamentService(new ProviderRegistry([fixtureProvider()]), new MemoryOperatorStore(), 60_000);
  const initial = service.getState();
  service.close();
  const set = fixtureSet("match-one");
  const event = {
    ...fixtureEvent(),
    phaseGroups: [{ id: "group-1", name: "Top 8", phaseName: "Top 8", setsLoaded: true, setsFetchedAt: null, sets: [set] }],
  };
  return {
    ...initial,
    event,
    operator: {
      ...initial.operator,
      selectedSetId: set.id,
      liveSelection: { providerId: event.providerId, eventInput: event.slug, phaseGroupId: set.phaseGroupId, setId: set.id },
    },
    overlay: deriveOverlayView(1, event, set, initial.operator.presentation, "fresh"),
  };
}

function render(state: ServerState, pendingCommands: readonly PendingCommand[] = [], connected = true): string {
  return renderToStaticMarkup(createElement(SceneRail, {
    state,
    pendingCommands,
    connected,
    send: () => true,
    error: null,
    dismissError: () => {},
  }));
}

describe("broadcast controls", () => {
  it("distinguishes live output from preview and labels immediate controls", () => {
    const html = render(scene());
    expect(html).toContain('aria-label="Broadcast controls"');
    expect(html.indexOf("Live output")).toBeLessThan(html.indexOf("Next set"));
    expect(html).toContain("Applies live");
    expect(html).toContain("Changes apply live. Restore fetches fresh data first.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Already live<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Restore previous<\/button>/);
  });

  it("allows taking the same set when hidden and offers an explicit show action", () => {
    const state = scene();
    const html = render({
      ...state,
      operator: { ...state.operator, presentation: { ...state.operator.presentation, overlayVisible: false } },
    });
    expect(html).toContain(">Hidden</span>");
    expect(html).toContain(">Show overlay</button>");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Take live<\/button>/);
    expect(html).toContain(">Take live</button>");
  });

  it("keeps hide available while a take is pending", () => {
    const html = render(scene(), [{ commandId: "take-1", type: "live.take" }]);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Hide overlay<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Taking live…<\/button>/);
  });

  it.each(["live.take", "live.restore"] as const)("keeps cancellation available for a hidden %s", (type) => {
    const state = scene();
    const html = render({
      ...state,
      operator: { ...state.operator, presentation: { ...state.operator.presentation, overlayVisible: false } },
    }, [{ commandId: "transition-1", type }]);
    expect(html).toContain(">Cancel transition</button>");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancel transition<\/button>/);
    expect(html).not.toContain(">Show overlay</button>");
  });

  it("disables live-changing controls while disconnected", () => {
    const html = render(scene(), [], false);
    expect(html).toContain(">Disconnected</span>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Hide overlay<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Swap sides<\/button>/);
  });

  it("limits metadata to two selections without disabling their removal", () => {
    const html = render(scene());
    expect(html).toContain("Choose up to two");
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(2);
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).not.toMatch(/type="checkbox"[^>]*disabled=""[^>]*checked=""/);
  });

  it("places broadcast controls before the bracket and collapses loaded-event setup", () => {
    vi.mocked(useTournamentSocket).mockReturnValue({
      state: scene(),
      socketStatus: "connected",
      error: null,
      animationEvents: [],
      pendingCommands: [],
      upgradeRequired: false,
      sendCommand: () => true,
      dismissError: () => {},
    });
    const html = renderToStaticMarkup(createElement(App));
    expect(html.indexOf('aria-label="Broadcast controls"')).toBeLessThan(html.indexOf('<main class="bracket"'));
    expect(html).not.toContain('class="event-loader"');
    expect(html).toContain("Change event");
    expect(html).not.toContain("Only Take live changes the broadcast");
  });

  it("does not call an empty preview already live", () => {
    const state = scene();
    const html = render({
      ...state,
      event: null,
      operator: { ...state.operator, selectedSetId: null, liveSelection: null },
      overlay: { ...state.overlay, setId: null, players: [null, null], status: "empty" },
    });
    expect(html).not.toContain("Already live");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Take live<\/button>/);
    expect(html).toContain(">No set</span>");
  });

  it("keeps command failures inside the persistent broadcast controls", () => {
    const html = renderToStaticMarkup(createElement(SceneRail, {
      state: scene(),
      pendingCommands: [],
      connected: true,
      send: () => true,
      error: "The previous set could not be loaded.",
      dismissError: () => {},
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("The previous set could not be loaded.");
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('class="scene__desk"'));
  });

  it("keeps auto-live opt-in and explains provider-confirmed completion", () => {
    const html = render(scene());
    expect(html).toContain("Auto-live next set");
    expect(html).toContain("StartGG marks the");
    expect(html).toContain("cancellable 10-second countdown");
    expect(html).toContain('aria-describedby="auto-take-help"');
    expect(html).not.toContain("Cancel auto-live");
  });

  it("keeps the enabled auto-live mode visible without opening settings", () => {
    const state = scene();
    const next = fixtureSet("match-two");
    const event = {
      ...state.event!,
      phaseGroups: [{ ...state.event!.phaseGroups[0]!, sets: [next] }],
    };
    const configured = {
      ...state,
      event,
      operator: { ...state.operator, selectedSetId: next.id, autoTakeEnabled: true },
    };
    const html = render(configured);
    expect(html.indexOf("Auto-live on")).toBeLessThan(html.indexOf('class="scene-settings"'));
    vi.mocked(useTournamentSocket).mockReturnValue({
      state: configured, socketStatus: "connected", error: null, animationEvents: [],
      pendingCommands: [], upgradeRequired: false, sendCommand: () => true, dismissError: () => {},
    });
    expect(renderToStaticMarkup(createElement(App))).toContain("Auto-live takes it on air after a 10-second countdown.");
  });

  it("groups every setting under a single Settings disclosure with concise live cues", () => {
    const html = render(scene());
    expect(html).toContain("<summary>Settings</summary>");
    expect(html).not.toContain("Live controls");
    expect(html).not.toContain("Automatic transitions");
    expect(html).toContain('aria-label="Broadcast settings"');
    expect(html).toContain('aria-label="Appearance settings"');
    expect(html).toContain('aria-label="OBS source settings"');
    expect(html).toContain(">Swap sides</button>");
    expect(html).toContain(">Restore previous</button>");
    expect(html).toContain("Auto-live next set");
    expect(html).toContain(">Octagon</button>");
    expect(html).toContain(">Minimal</button>");
    expect(html).toContain("Player details (Octagon)");
    expect(html).toContain(">Copy URL</button>");
    expect(html).toContain(">Open overlay</a>");
    expect(html.match(/Applies live/g)).toHaveLength(1);
    expect(html).toContain('aria-describedby="live-visibility-help"');
    expect(html).toContain('id="live-visibility-help" class="sr-only"');
  });

  it("shows a cancellable countdown outside collapsed settings", () => {
    const html = render({
      ...scene(),
      autoTake: { status: "countdown", eventId: "event-1", setId: "match-two", takeAt: new Date(Date.now() + 10_000).toISOString() },
    });
    expect(html).toContain("Next set goes live in 10s.");
    expect(html).toContain("Cancel auto-live");
    expect(html.indexOf("Cancel auto-live")).toBeLessThan(html.indexOf('class="scene-settings"'));
  });

  it("keeps cancellation and hiding available while automatically fetching", () => {
    const html = render({
      ...scene(),
      autoTake: { status: "taking", eventId: "event-1", setId: "match-two", takeAt: new Date().toISOString() },
    });
    expect(html).toContain("Automatically fetching the next set");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancel auto-live<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Hide overlay<\/button>/);
  });

  it("shows automatic failures as an explicit dismissible alert", () => {
    const html = render({ ...scene(), autoTake: { status: "error", message: "Automatic Take live failed." } });
    expect(html).toContain('role="alert">Automatic Take live failed.');
    expect(html).toContain("Dismiss auto-live error");
  });
});
