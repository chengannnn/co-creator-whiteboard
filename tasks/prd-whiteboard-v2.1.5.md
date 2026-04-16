# PRD: Whiteboard v2.1.5 - Viewport Zoom Refinement & Interaction Polish

## Introduction

Whiteboard v2.1.5 targets 3 specific interaction defects that survived from v2.1.4: the eraser cursor still suffers from a dual-cursor conflict (CSS system cursor vs Canvas custom rendering), the `+` / `-` zoom buttons at the bottom-right corner likely still bypass the center-based zoom algorithm, and the layer management icons need to be replaced with simpler arrow-based SVGs.

**Branch:** `feature/whiteboard-v2.1.5`

---

## Goals

- Eliminate the dual-cursor conflict on eraser: hide CSS/system cursor entirely, render the eraser ring exclusively on the Interactive Canvas layer
- Extract the viewport-center zoom algorithm into a shared `zoomFromCenter` function and wire it to BOTH the `+`/`-` buttons AND the wheel event
- Replace the 4 layer buttons with minimal arrow-based SVG icons (↑, ↓, ⤒, ⤓)

---

## User Stories

### US-001: Refactor eraser cursor to use Interactive Canvas rendering only (P0/Critical)

**Description:** As a user, I want the eraser ring to follow my mouse smoothly on the Interactive Canvas layer, so that there is only ONE cursor visible and it stays locked to my mouse position at all times.

**Root Cause Analysis:** Two cursor systems are fighting each other: (1) the browser/CSS cursor renders a pink system eraser icon, and (2) the Canvas draws a custom ring. The Canvas ring's coordinates are not being updated in `pointermove`, leaving a dead ring at the initial position while the system cursor moves independently.

**Acceptance Criteria:**
- [ ] When `AppState.activeTool === 'eraser'`, the canvas container CSS cursor is set to `cursor: none;` to completely hide the browser/system cursor including the pink eraser icon
- [ ] The eraser ring is rendered ONLY on the Interactive Canvas layer (not via CSS), drawn programmatically in the `pointermove` handler
- [ ] On each `pointermove` event, the Interactive Canvas ring is cleared via `clearRect` (or full canvas clear) before being redrawn at the new `(currentX, currentY)` position
- [ ] The ring reaches 60fps smooth following -- no lag, no ghost rings left behind at previous positions
- [ ] When the mouse pointer leaves the canvas container, the eraser ring is cleared from the Interactive Canvas
- [ ] When `activeTool` changes away from `'eraser'`, the ring is cleared and normal cursor is restored
- [ ] Visually: only ONE eraser ring is visible at any time, and it is locked to the current mouse position during both idle hover and active drag
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Extract shared zoomFromCenter function and wire it to +/- buttons (P0/Critical)

**Description:** As a user, I want the `+` and `-` buttons at the bottom-right corner to zoom from the viewport center, so that my focal point stays on screen when I click zoom buttons.

**Root Cause Analysis:** The viewport-center zoom formula was likely applied ONLY to the mouse wheel event. The `+` / `-` React components probably still call a bare `setZoom(zoom + 0.1)` without any scroll compensation, causing the view to fly away.

**Acceptance Criteria:**
- [ ] A shared `zoomFromCenter` function is created and exported (e.g., in a view utils or store file)
- [ ] `zoomFromCenter(targetZoom)` implements the following logic:
  ```
  // 1. Get the canvas container's half dimensions as viewport center
  const cx = containerWidth / 2;
  const cy = containerHeight / 2;

  // 2. Convert screen center to world coordinates
  const worldX = (cx - appState.scrollX) / appState.zoom;
  const worldY = (cy - appState.scrollY) / appState.zoom;

  // 3. Recalculate scroll to compensate for the new zoom
  const newScrollX = cx - (worldX * targetZoom);
  const newScrollY = cy - (worldY * targetZoom);

  // 4. Atomically update zoom, scrollX, scrollY
  updateAppState({ zoom: targetZoom, scrollX: newScrollX, scrollY: newScrollY });
  ```
- [ ] The `+` button's `onClick` handler calls `zoomFromCenter(zoom + ZOOM_STEP)` instead of a bare `setZoom`
- [ ] The `-` button's `onClick` handler calls `zoomFromCenter(zoom - ZOOM_STEP)` instead of a bare `setZoom`
- [ ] The existing mouse wheel handler ALSO uses `zoomFromCenter` (refactored to share the same function, not duplicated logic)
- [ ] A square drawn at the viewport center stays at the screen's absolute center through 5 consecutive clicks of `+` and 5 consecutive clicks of `-`
- [ ] The square does not drift horizontally or vertically by even a few pixels during these zoom steps
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Replace layer management icons with minimal arrow SVGs (P1)

**Description:** As a user, I want the layer buttons to use simple, intuitive arrow icons, so that I can instantly understand what each button does without thinking.

**Acceptance Criteria:**
- [ ] **Bring Forward** icon replaced with a simple upward arrow: ↑ (SVG or icon component)
- [ ] **Send Backward** icon replaced with a simple downward arrow: ↓ (SVG or icon component)
- [ ] **Bring to Front** icon replaced with an upward arrow with a horizontal line above it: ⤒ (SVG with an arrow ↑ and a line above it, like a top barrier)
- [ ] **Send to Back** icon replaced with a downward arrow with a horizontal line below it: ⤓ (SVG with an arrow ↓ and a line below it, like a bottom barrier)
- [ ] Icons are rendered as SVG elements or imported icon components (not Unicode characters, for better visual consistency)
- [ ] The **Disabled state** (reduced opacity for unclickable buttons) still applies correctly to the new icons
- [ ] The **Hover state** (visual feedback when mouse enters button) still applies correctly to the new icons
- [ ] The Layer button group's layout (position, spacing, `|` dividers) remains unchanged
- [ ] Clicking each button still correctly triggers the corresponding layer operation from US-004 (v2.1.4)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: `cursor: none;` is applied to the canvas container when `activeTool === 'eraser'`
- FR-2: The eraser ring is drawn on the Interactive Canvas layer, not via CSS `cursor` property
- FR-3: `clearRect` (or equivalent) is called at the top of each `pointermove` handler before redrawing the eraser ring at the current mouse position
- FR-4: The eraser ring is cleared when the mouse leaves the canvas or when the active tool changes away from `'eraser'`
- FR-5: A single shared `zoomFromCenter(targetZoom)` function exists and is called by `+` button, `-` button, and wheel event
- FR-6: `zoomFromCenter` computes viewport center from the actual container dimensions, converts to world coordinates, recalculates scroll compensation, and applies all three values atomically
- FR-7: No bare `setZoom` calls remain anywhere in the codebase without scroll compensation
- FR-8: Layer button icons use SVG with upward/downward arrows and top/bottom horizontal lines
- FR-9: All existing disabled/hover visual states work correctly with the new SVG icons

---

## Non-Goals (Out of Scope)

- No new tools, features, or layer operations
- No changes to the layer management data logic (US-004 from v2.1.4 is stable as-is)
- No marquee selection, grouping, or drawing tool changes
- No changes to the Undo/Redo system
- No pan/scroll behavior changes beyond what's required for zoom compensation

---

## Design Considerations

- Eraser ring: reuse the same visual size/style as the existing v2.1.4 implementation, just move it from CSS to Canvas rendering
- Layer SVG icons should be ~20x20 or ~24x24 pixels to match existing toolbar button icon size
- Arrow icons should use a consistent stroke width and style (matching the project's existing SVG icon conventions)
- "Bring to Front" SVG: horizontal line at top + arrow pointing up toward it
- "Send to Back" SVG: horizontal line at bottom + arrow pointing down toward it

---

## Technical Considerations

- The `zoomFromCenter` function needs access to `containerWidth` and `containerHeight` -- these should be obtained from the canvas container's bounding rect or a React ref, not hardcoded
- Interactive Canvas layer must be cleared and redrawn on EVERY `pointermove` tick to avoid ghost artifacts -- this means the render loop should not batch or throttle these clears
- The existing wheel event handler's zoom logic should be identified and refactored to call `zoomFromCenter` rather than duplicating the formula
- `zoomFromCenter` should clamp `targetZoom` to the same min/max bounds that the existing zoom system uses
- If the codebase uses Zustand, Redux, or a custom store for `appState`, the `updateAppState` call must match the existing pattern

---

## Success Metrics

- Eraser: 0% occurrence of dual cursors or frozen rings; eraser ring follows mouse at 60fps with zero visual artifacts
- Zoom buttons: a shape at viewport center stays within 1 pixel of screen center through 10 consecutive zoom steps (both + and -)
- Layer icons: visually clear and consistent with the arrow metaphor; no regression in button disabled/hover states
- All v2.1.4 features remain fully functional after these changes

---

## Execution Order (Strict Dependency Chain)

1. **US-001** (P0) - Eraser cursor refactor -- must pass verification before any other US
2. **US-002** (P0) - Extract `zoomFromCenter` and wire to buttons -- must pass verification before any other US
3. **US-003** (P1) - Replace layer icons -- standalone, no dependency on US-001 or US-002

---

## Open Questions

- What is the exact current implementation of the eraser ring (size in pixels, stroke color, fill opacity)? This determines what to replicate on the Canvas layer.
- What is the current `ZOOM_STEP` value (e.g., 0.1, 0.15)? The `+`/`-` buttons should use the same step.
- Does the codebase have an existing icon component library or SVG icon directory, or should these be inlined as JSX SVG elements in the layer button component?
