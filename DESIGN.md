---
name: Tournament Overlay
description: A nautical chart-room operator console paired with a tactile Octagon broadcast overlay.
colors:
  deep-navy: "#202942"
  raised-navy: "#2c3856"
  canvas: "#e8e5dd"
  paper: "#f8f5ec"
  sand: "#f1d3a0"
  brass: "#d99b33"
  octagon-purple: "#68458f"
  harbor-teal: "#185f64"
  muted-ink: "#5b6171"
  rule: "#c8c3b6"
  healthy: "#2c775a"
  warning: "#a76a1b"
  danger: "#a23b42"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Trebuchet MS, Segoe UI, sans-serif"
    fontSize: "clamp(25px, 2vw, 42px)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Avenir Next, Avenir, Trebuchet MS, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 800
    lineHeight: 1.1
  body:
    fontFamily: "Avenir Next, Avenir, Trebuchet MS, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "Avenir Next, Avenir, Trebuchet MS, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  small: "4px"
  control: "7px 15px"
  panel: "8px 24px"
  score: "10px 28px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.octagon-purple}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "42px"
  button-load:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.deep-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "42px"
  input:
    backgroundColor: "#fffdf7"
    textColor: "{colors.deep-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "42px"
  panel-dark:
    backgroundColor: "{colors.raised-navy}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "24px 22px"
---

# Design System: Tournament Overlay

## Overview

**Creative North Star: "The Tournament Chart Room"**

Tournament Overlay combines a practical event operations desk with the tactile, slightly whimsical nautical identity of the Octagon broadcast package. The dashboard is paper-forward and dense enough to scan bracket flow quickly; its command bar and scene rail use deep navy to signal durable controls and current broadcast state. The overlay amplifies the same sand, brass, purple, teal, helm, and tentacle vocabulary into a clean transparent broadcast silhouette.

Decoration must carry identity or structure. Fine paper flecks, diagonal rail texture, asymmetric corners, and dimensional control shadows are deliberate material cues, not generic background effects.

**Key Characteristics:**

- Warm paper and canvas work surfaces framed by deep navy command areas
- Purple and teal as stable port/starboard identities
- Brass and sand for emphasis, loading, and tournament ornament
- Asymmetric rounded corners that suggest fitted plates rather than generic cards
- Strong player names with compact uppercase labels and telemetry
- Motion only when a set or score changes

## Colors

The palette feels like a night-blue chart case opened over warm event paperwork, with purple and teal preserved from the Octagon identity.

### Primary

- **Deep Navy** (`#202942`): command bar, round headers, score outlines, and primary ink.
- **Octagon Purple** (`#68458f`): primary buttons, port-side scores, selected states, and signature linework.

### Secondary

- **Harbor Teal** (`#185f64`): starboard-side scores and completed-set state.
- **Chart Sand** (`#f1d3a0`): event loading actions, player plates, chips, and broadcast surfaces.
- **Brass Marker** (`#d99b33`; overlay variant `#e3ad4f`): key rules, helm trim, and restrained highlights.

### Neutral

- **Canvas** (`#e8e5dd`): dashboard page background.
- **Paper** (`#f8f5ec`): bracket cards and light surfaces.
- **Raised Navy** (`#2c3856`): scene rail and darker secondary surface.
- **Muted Ink** (`#5b6171`): secondary copy and labels.
- **Rule** (`#c8c3b6`): dividers and quiet borders.

### Status

- **Healthy** (`#2c775a`), **Warning** (`#a76a1b`), and **Danger** (`#a23b42`) always pair with explicit text.

**The Side Identity Rule.** Purple is port/player one; teal is starboard/player two. Do not swap those meanings to decorate unrelated state.

## Typography

**Display Font:** Avenir Next with Avenir, Trebuchet MS, and Segoe UI fallbacks
**Body Font:** Avenir Next with the same system-safe fallbacks
**Label/Mono Font:** Avenir Next for labels; UI monospace only for the literal OBS URL

**Character:** One humanist sans family keeps the operator console compact and familiar. Heavy weights and controlled uppercase labels give the overlay its broadcast force without sacrificing dashboard readability.

### Hierarchy

- **Display** (900, fluid `25-42px`, `1`): player names, boot title, and major event headings.
- **Title** (800, `23px`, `1.1`): scene and workspace headings.
- **Body** (500, `15px`, `1.4`): controls, bracket detail, and explanatory copy.
- **Label** (900, `10-11px`, `0.07-0.09em`, uppercase): phase, round, connection, and set status.

**The Player Name Rule.** Player names receive the strongest type weight; seed, pronoun, location, and social metadata must truncate before the name becomes unreadable.

## Layout

The desktop dashboard begins with a sticky three-part command bar, then a phase strip, followed by a flexible bracket workspace and a fixed 336px scene rail. Rounds stack vertically in chronological order with clear navy headers; sets wrap into a dense responsive grid within each round so wheel, trackpad, keyboard, and touch navigation all follow the page's natural vertical axis. The 8px spacing rhythm tightens to 4px only inside tabs and telemetry.

Below 1080px the scene rail moves beneath the bracket. Below 720px the command bar wraps, controls become single-column, and each round's set grid collapses to one column while preserving chronological DOM order.

The overlay owns a transparent 1920x1080 canvas and keeps all artwork in the upper broadcast-safe band. It scales the complete stage proportionally to the browser source rather than reflowing individual plates.

## Elevation & Depth

The dashboard uses shallow structural shadows: the command bar floats over content, controls depress on activation, and the selected set receives a focused outline. Most grouping comes from tonal surfaces and borders. The overlay is intentionally more dimensional, using beveled borders, inset brass/sand rings, paper texture, and compact drop shadows so it remains legible over gameplay.

### Shadow Vocabulary

- **Command lift** (`0 8px 20px rgba(32, 41, 66, 0.22)`): sticky command bar only.
- **Control press** (`0 3px 0 rgba(32, 41, 66, 0.35)`): actionable buttons at rest; removed on active press.
- **Broadcast plate** (`0 4px 0 rgba(32, 41, 66, 0.45), 0 10px 10px rgba(0, 0, 0, 0.26)`): Octagon player and match plates.

**The Structural Shadow Rule.** Shadows explain stacking, pressability, or broadcast separation; they are not ambient decoration for every panel.

## Shapes

The signature shape is a fitted plate with opposing asymmetric corners: usually `7px 15px`, `7px 17px`, or the more pronounced `10px 30px` overlay plate. Score boxes mirror each other across port and starboard. Circles are reserved for the helm, status dots, and compact numeric badges. Pills are reserved for small status labels.

## Components

### Buttons

- **Shape:** 42px tall, 2px outline, asymmetric `7px 15px` corners, and a small press shadow.
- **Primary:** Octagon Purple with white text.
- **Load:** Chart Sand with Deep Navy text and Brass border.
- **Hover / Focus:** brightness increase on hover; 3px warm-brass focus outline with 2px offset.
- **Secondary:** transparent or white surface with a quiet gray rule.

### Inputs

- **Shape:** 42px tall with asymmetric corners matching buttons.
- **Surface:** warm near-white (`#fffdf7`) with a strong gray-blue border.
- **Label:** compact uppercase text above the field; labels never rely on placeholders.

### Chips

- **Style:** sand broadcast chip with Deep Navy border and asymmetric corners; dashboard status chips may use a true pill because they are telemetry.
- **State:** purple/teal sublabels preserve port/starboard identity.

### Cards / Containers

- **Set cards:** warm paper, subtle fleck material, left state rail, and asymmetric corners. Selected cards add a purple outline; completed cards use teal on the state rail.
- **Scene rail:** Raised Navy with a restrained diagonal fabric/paint texture.
- **Round headers:** Deep Navy bars with compact labels and Chart Sand counts.

## Do's and Don'ts

### Do:

- **Do** preserve chronological round order in a vertically scannable flow on every screen size.
- **Do** keep connection and freshness state visible, textual, and timestamped.
- **Do** truncate long metadata before player names or scores collide.
- **Do** honor `prefers-reduced-motion` for score, helm, and set transitions.
- **Do** reserve the richer nautical material treatment for set cards, the scene rail, and the overlay.

### Don't:

- **Don't** turn every dashboard region into an equal floating card.
- **Don't** add generic blue gradients; the existing texture vocabulary is paper, paint, brass, and fitted plates.
- **Don't** repurpose purple and teal so side identity becomes ambiguous.
- **Don't** use continuous ambient motion when tournament state is unchanged.
- **Don't** rely on color alone for connection, error, or freshness state.
