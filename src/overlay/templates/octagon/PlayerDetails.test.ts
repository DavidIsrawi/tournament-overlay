import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayPlayer, OverlayView } from "../../../shared/contracts.ts";
import OctagonOverlay from "./OctagonOverlay.tsx";
import { PlayerMetadata, PlayerName } from "./PlayerDetails.tsx";

const player: OverlayPlayer = {
  sourceEntrantId: "one",
  displayName: "Player 明",
  prefix: "Sponsor",
  score: 1,
  seed: 42,
  pronouns: "they/them",
  social: "@captain",
  location: "State should never appear",
  country: "Canada",
  isWinner: false,
};

describe("readable player markup", () => {
  it("measures only selected content outside animation targets and the accessibility tree", () => {
    const html = renderToStaticMarkup(createElement(PlayerMetadata, { player, fields: ["country", "social"] }));
    expect(html).toContain('class="metadata-probes" aria-hidden="true"');
    expect(html).toContain('role="img" aria-label="Canada flag"');
    expect(html).toContain("🇨🇦");
    expect(html).toContain(">CA<");
    expect(html).toContain("@captain");
    expect(html.indexOf(">CA<")).toBeLessThan(html.indexOf("@captain"));
    expect(html).not.toContain("State should never appear");
    expect(html).not.toContain("they/them");
    expect(html).not.toContain('class="chip"');
  });

  it("keeps full source text and isolates script direction in the name", () => {
    const name = "Captain 明 ⚓ & friends";
    const html = renderToStaticMarkup(createElement(PlayerName, { name, prefix: "Sponsor" }));
    expect(html).toContain('dir="auto" style="font-size:31px;flex-shrink:0"');
    expect(html).toContain('title="Captain 明 ⚓ &amp; friends"');
    expect(html).toContain('class="player-name-probe" aria-hidden="true"');
    expect(html).toContain(">Captain 明 ⚓ &amp; friends</strong>");
  });

  it("passes the same metadata selection to both mirrored sides and abbreviates the round", () => {
    const view: OverlayView = {
      revision: 1,
      status: "ready",
      setId: "set",
      tournamentName: "Tournament",
      eventName: "Singles",
      phaseName: "Top 8",
      roundName: "Winners Quarter-Final",
      players: [player, { ...player, sourceEntrantId: "two" }],
      metadataFields: ["country", "seed"],
    };
    const html = renderToStaticMarkup(createElement(OctagonOverlay, { view, connected: true, animationEvents: [] }));
    expect(html).toContain('<strong title="Winners Quarter-Final">Winners QF</strong>');
    expect(html.match(/>CA</g)).toHaveLength(2);
    expect(html.match(/<b>Seed<\/b>/g)).toHaveLength(2);
    expect(html).not.toContain("they/them");
    expect(html).not.toContain("@captain");
  });
});
