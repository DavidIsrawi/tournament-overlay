# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tournament stream operators running a local production scene. They need to find the correct StartGG bracket and set quickly, recover from connectivity issues, and expose a stable browser-source URL to OBS.

## Product Purpose

Tournament Overlay is a focused, read-only tournament dashboard and OBS scoreboard platform. It centralizes upstream polling on a local server, keeps operator presentation choices separate from tournament data, and restores the current scene after restart.

## Positioning

One normalized scene powers both an information-dense operator surface and a broadcast-specific Octagon overlay, while provider adapters keep the product independent of StartGG-specific response shapes.

## Operating Context

The server, dashboard, and OBS browser source run on one operator machine. Operators browse phase groups and rounds, select a set, monitor freshness, adjust presentation side order, and leave the overlay URL open in OBS.

## Capabilities and Constraints

- StartGG integration uses only the official GraphQL API and is read-only.
- A deterministic demo provider exercises the same provider interface without credentials.
- Browser clients never contact tournament providers directly.
- Public GraphQL cannot supply live stage-strike or DSR task state.
- Provider source data remains immutable; local side swapping is presentation state.
- The first release is a local single-operator tool, not a hosted multi-user service.

## Brand Commitments

The Octagon overlay preserves the supplied nautical identity: deep navy framing, sand-colored printed plates, brass fittings, purple and teal player accents, helm/crest geometry, anchor and tentacle motifs, and deliberate score motion. The dashboard borrows this language selectively without sacrificing scanability.

## Evidence on Hand

- Existing user-owned Octagon layout and logo at `/Users/davidisrawi/Workspaces/Personal/TournamentStreamHelper/custom_layouts/scoreboard_octagon`.
- No licensing terms, customer claims, benchmarks, or third-party brand permissions were supplied; none should be invented.

## Product Principles

- Make source freshness and recovery unmistakable.
- Keep the operator's next action visible and keyboard accessible.
- Preserve immutable provider truth beneath reversible presentation choices.
- Demonstrate every workflow without a token through the same provider boundary.
- Prefer a small, inspectable local system over framework weight.

## Accessibility & Inclusion

The dashboard requires WCAG-conscious contrast, visible focus, semantic controls, useful status announcements, and responsive layouts. The overlay must honor `prefers-reduced-motion`.
