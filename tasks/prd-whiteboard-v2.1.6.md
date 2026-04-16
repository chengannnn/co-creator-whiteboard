# PRD: Whiteboard v2.1.6 - Wheel Zoom Fix, Icon Polish & Ungroup System

## Introduction

Whiteboard v2.1.6 targets 4 specific UX polish items and completes the group/ungroup system:

1. **Wheel zoom is unusable** — `deltaY` directly drives zoom with `ZOOM_FACTOR = 0.08`, causing a single wheel tick to jump from 100% → 10% or 100% → 500%, completely breaking usability.
2. **BottomPanel `+` / `−` buttons use 0.25 step** — inconsistent with the intended zoom granularity.
3. **Layer icon height misalignment** — Bring Forward ↑ and Send Backward ↓ arrow shafts are too short, visually inconsistent with Bring to Front and Send to Back.
4. **Missing "Sharp Corner" toggle** — users can apply round corners but have no way to revert them back to sharp corners.
5. **Missing standalone "Ungroup" button** — the group/ungroup system from v2.1.4 has Group but no explicit Ungroup button.

**Branch:** `feature/whiteboard-v2.1.6`

---

## Goals

- Fix wheel zoom to use a fixed 0.1 (10%) step per tick, keeping `zoomFromCenter` for anchor point preservation
- Unify BottomPanel `+` / `−` button step from 0.25 to 0.1 for consistent zoom granularity
- Align layer icon SVG heights visually
- Add Sharp Corner button with mutual-exclusion state machine alongside Round Corner
- Add standalone Ungroup button with correct availability logic
- Replace Group button icon with "converging squares" SVG

---

## User Stories

### US-001: Fix wheel zoom step to fixed 0.1 per tick (P0/Critical)

**Description:** As a user, I want the mouse wheel to zoom smoothly at a predictable rate, so that I can zoom in and out without the view jumping uncontrollably.

**Root Cause Analysis:** In `CanvasComponent.tsx` the wheel handler uses `delta = -e.deltaY * ZOOM_FACTOR` where `ZOOM_FACTOR = 0.08`. A typical wheel tick has `deltaY ≈ 100`, so `delta ≈ -8`. `currentScale + delta` goes from `1.0` to `-7`, clamped to `0.1`. This is a single jump from 100% to 10%. The fix is to ignore the magnitude of `deltaY` and only use its sign to determine direction, applying a fixed 0.1 step.

**Acceptance Criteria:**
- [ ] `CanvasComponent.tsx` wheel handler: extract `direction = Math.sign(e.deltaY)` and apply `step = direction * 0.1`
- [ ] `newZoom = direction > 0 ? currentScale - 0.1 : currentScale + 0.1`, clamped to `[MIN_ZOOM, MAX_ZOOM]`
- [ ] Remove or ignore `ZOOM_FACTOR` constant (no longer used by wheel)
- [ ] Wheel handler still calls `zoomFromCenter(newZoom, ...)` to preserve viewport-center anchor
- [ ] `ZOOM_STEP = 0.1` constant is exported or defined for reuse
- [ ] BottomPanel `+` / `−` buttons are updated from `0.25` to `0.1` step
- [ ] One wheel tick changes zoom by exactly 10% (e.g., 100% → 110% or 100% → 90%)
- [ ] Rapid scrolling is smooth: each tick is exactly one step, no skipping or accumulation
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Align layer management icon heights (P1)

**Description:** As a user, I want all 4 layer management icons to have consistent visual height, so the toolbar looks polished.

**Root Cause Analysis:** In `UnifiedToolbar.tsx`, `BringForwardIcon` (line 53-58) draws a short upward arrow from `y=15` to `y=11` (4px shaft). `SendBackwardIcon` (line 61-66) draws a short downward arrow from `y=5` to `y=13` (8px shaft). Meanwhile `BringToFrontIcon` and `SendToBackIcon` span `y=5` to `y=19` (14px total). The height mismatch is visually noticeable.

**Acceptance Criteria:**
- [ ] `BringForwardIcon`: extend arrow shaft so the overall SVG bounding box height matches BringToFrontIcon (span ~`y=5` to `y=19`)
- [ ] `SendBackwardIcon`: extend arrow shaft so the overall SVG bounding box height matches SendToBackIcon (span ~`y=5` to `y=19`)
- [ ] Arrow head/tip positions and proportions remain visually consistent
- [ ] All 4 icons share the same `viewBox="0 0 24 24"` (no change needed)
- [ ] Hover and disabled states still work correctly (no change to CSS logic)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Add "Sharp Corner" button with mutual-exclusion state (P1)

**Description:** As a user, I want a "Sharp Corner" button next to "Round Corner", so I can easily revert rounded rectangles back to sharp corners.

**Root Cause Analysis:** The Round Corner button toggles `borderRadius` between 12 and 0. But once a shape has `borderRadius = 12`, clicking "Round Corner" again just toggles it back to 0. A dedicated "Sharp Corner" button provides explicit intent and visual clarity.

**Technical Detail:**
- The Round Corner button uses `isRoundCornerEnabled` state in `App.tsx`. When `true`, `borderRadius = 12`; when `false`, `borderRadius = 0`.
- The Sharp Corner button will set `isRoundCornerEnabled = false` and apply `borderRadius = 0` to all selected eligible shapes.

**Acceptance Criteria:**
- [ ] Add a "Sharp Corner" button immediately to the left of the "Round Corner" button in Row 1 of `UnifiedToolbar`
- [ ] Sharp Corner icon: SVG showing a sharp-cornered rectangle (3-sided or 4-sided, not rounded)
- [ ] The Sharp Corner button has the **same enabled/disabled condition** as Round Corner: only enabled for `rectangle`, `rectangle-solid`, `rhombus`, `rhombus-solid` tools
- [ ] **Mutual exclusion:** Clicking Sharp Corner sets `isRoundCornerEnabled = false`. Clicking Round Corner sets `isRoundCornerEnabled = true`. They are visually exclusive — at most one can be "active" (highlighted border/background) at a time.
- [ ] When Sharp Corner is clicked with eligible selected elements, their `borderRadius` is set to `0`, a history snapshot is pushed, and `onSceneMutate('update')` is called
- [ ] When Sharp Corner is clicked with no eligible selected elements, it only changes the global preset (new shapes will have `borderRadius = 0`)
- [ ] Pass `isSharpCornerEnabled` (derived from `!isRoundCornerEnabled` when active tool is eligible) to `UnifiedToolbar` as a separate prop for visual state
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Add standalone "Ungroup" button with correct state machine (P0/Critical)

**Description:** As a user, I want a dedicated "Ungroup" button to break apart grouped elements, so I can selectively ungroup and edit individual shapes within a group.

**Root Cause Analysis:** v2.1.4's Group/Ungroup system uses a single button that auto-switches between Group and Ungroup mode. Users want explicit Group and Ungroup buttons for clarity. Additionally, the Group icon should be replaced with a "converging squares" icon.

**Technical Detail — State Machine:**

| Button | Enabled When | Disabled When |
|--------|-------------|---------------|
| Group | `selectedElements.length >= 2` AND they do NOT share a common `groupId` | Fewer than 2 elements, OR all selected share a groupId |
| Ungroup | `selectedElements.length >= 2` AND ALL selected elements share a common `groupId` (the group is fully selected) | No selection, OR selection spans multiple groups, OR group is only partially selected |

**Technical Detail — Ungroup Logic:**

```
// 1. Find the shared groupId
const groupId = getSharedGroupId(selectedElements);
if (!groupId) return;

// 2. History snapshot BEFORE modification
history.push();

// 3. Remove groupId from each element's groupIds array
//    CRITICAL: Do NOT change element array order (Z-Index preserved)
elements.forEach(el => {
  el.groupIds = el.groupIds.filter(id => id !== groupId);
});

// 4. Broadcast updates
onSceneMutate('update');

// 5. Re-render (selection stays on the same element IDs, now ungrouped)
```

**Acceptance Criteria:**
- [ ] Replace the single Group/Ungroup button with **two separate buttons**: Group and Ungroup
- [ ] **Group icon**: Replace current `GroupIcon` with an SVG of "four squares converging toward center" (reference: prototype image)
- [ ] **Ungroup icon**: New SVG of "four squares spreading outward from center" (reference: prototype image)
- [ ] Group button enabled: `selectedElements.length >= 2` AND NOT `areElementsInSameGroup(selectedElements)`
- [ ] Ungroup button enabled: `selectedElements.length >= 2` AND ALL selected elements share the same `groupId` (check: get the groupId from first element, verify every other selected element has it, AND verify no other elements with that groupId exist outside the selection — i.e., the group is fully selected)
- [ ] Clicking Ungroup: find shared `groupId`, remove it from each selected element's `groupIds` array via `filter`, push history, call `onSceneMutate('update')`, re-render
- [ ] **Z-Index preserved**: Element order in `Scene.elements` array is NOT changed during ungroup
- [ ] Both buttons have correct hover and disabled visual states (opacity 0.4 for disabled)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: Wheel zoom uses `Math.sign(e.deltaY)` for direction, applies fixed `0.1` step per tick
- FR-2: Wheel zoom calls `zoomFromCenter(newZoom, ...)` for viewport-center anchoring
- FR-3: BottomPanel `+` / `−` buttons use `0.1` step (not `0.25`)
- FR-4: All 4 layer icon SVGs have consistent visual height (~14px span in viewBox)
- FR-5: Sharp Corner button exists next to Round Corner button in Row 1
- FR-6: Sharp Corner and Round Corner are mutually exclusive (radio-button behavior)
- FR-7: Sharp Corner applies `borderRadius = 0` to eligible selected shapes + pushes history
- FR-8: Sharp Corner sets global preset for new shapes (next drawn shape has `borderRadius = 0`)
- FR-9: Two separate Group/Ungroup buttons replace the single toggle button
- FR-10: Group icon shows converging squares; Ungroup icon shows spreading squares
- FR-11: Ungroup removes the shared `groupId` from each element's `groupIds` array without reordering elements
- FR-12: Ungroup pushes a history snapshot before modification

---

## Non-Goals (Out of Scope)

- No changes to grouping creation logic (`groupElements` in `Scene.ts`)
- No nested group support (groups within groups)
- No changes to the existing layer ordering data logic
- No new drawing tools or shape types
- No changes to pan/scroll behavior beyond zoom step
- No keyboard shortcuts for Sharp Corner or Ungroup

---

## Design Considerations

- Sharp Corner icon: use a simple rectangle with sharp (not rounded) corners, e.g., a 3-sided or 4-sided rect SVG
- Group icon: four small squares positioned at corners, with lines/paths showing inward arrows or convergence toward center
- Ungroup icon: four small squares at center, with outward arrows showing them spreading apart
- Both Group and Ungroup icons should be ~18x18 or ~20x20 to match existing toolbar button icon sizes
- Sharp Corner button: same visual style as Round Corner — when "active", show highlighted border/background; when inactive but enabled, normal style; when disabled, reduced opacity

---

## Technical Considerations

- The `ZOOM_FACTOR = 0.08` constant in `CanvasComponent.tsx` should be removed or renamed since it's no longer used by the wheel handler
- `0.1` step should be defined as a named constant (e.g., `ZOOM_STEP = 0.1`) for reuse between wheel handler and BottomPanel
- BottomPanel currently calls `onZoom(Math.round((scale +/- 0.25) * 100) / 100)`. Change `0.25` to `0.1`
- `App.tsx` uses `isRoundCornerEnabled` boolean state. The Sharp Corner button will set this to `false` and also need to visually indicate "active" when `false` (for eligible tools). Consider deriving `isSharpCornerActive = !isRoundCornerEnabled && canRoundCorner` for toolbar prop
- The ungroup check for "group fully selected" needs to verify: (a) all selected elements share a groupId, AND (b) no other non-selected elements have that groupId. This ensures we don't partially ungroup
- `Scene.ungroupElements(groupId)` or similar method should be added if it doesn't exist

---

## Success Metrics

- Wheel zoom: 1 tick = exactly 10% zoom change, smooth and predictable at any speed
- +/- buttons: 1 click = exactly 10% zoom change, consistent with wheel
- Layer icons: all 4 have visually identical height in the toolbar
- Sharp Corner: user can toggle between round and sharp corners with 1 click each
- Ungroup: selecting all members of a group and clicking Ungroup breaks the group, elements remain in place at their original Z-Index positions

---

## Execution Order

1. **US-001** (P0) - Wheel zoom fix + unify +/- step — must pass verification first
2. **US-002** (P1) - Layer icon height alignment — standalone visual fix
3. **US-003** (P1) - Sharp Corner button — standalone, depends on existing Round Corner logic
4. **US-004** (P0) - Ungroup button + icon replacement — depends on existing group logic, completes the group system

---

## Open Questions

- Should the Sharp Corner button also have a keyboard shortcut? (e.g., `Shift+R` for Sharp, `R` for Round)
- Should the Ungroup button also support a keyboard shortcut? (e.g., `Shift+G` for ungroup)
