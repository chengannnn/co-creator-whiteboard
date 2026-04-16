# PRD: Whiteboard v2.1.4 - Canvas View Engine Upgrade & Layer Management

## Introduction

Whiteboard v2.1.4 resolves critical canvas coordinate/view-matrix bugs that survived from v2.1.3, overhauls the zoom engine to anchor on the viewport center instead of the origin, and introduces a complete Z-Index / Layer Management system for controlling element stacking order.

**Branch:** `feature/whiteboard-v2.1.4`

---

## Goals

- Fix reverse-direction drawing (left/up drag) so shapes never disappear or distort
- Fix eraser cursor so the icon follows the mouse during drag
- Replace origin-based zoom with viewport-center-based zoom
- Add layer management UI (4 buttons) with correct enable/disable state
- Add layer management core logic (array reordering) with Undo/Redo support
- All P0 bug fixes must pass verification before any layer-management code begins

---

## User Stories

### US-001: Fix reverse-direction drawing with immutable origin coordinates (P0/Critical)

**Description:** As a user, I want to draw shapes by dragging in any direction (including left and up), so that the shape always appears correctly on the canvas regardless of drag direction.

**Root Cause Analysis:** During `pointermove`, the origin point (`originX` / `originY`) recorded at `pointerdown` is being incorrectly overwritten. Once the origin drifts, `Math.min` / `Math.abs` calculations produce garbage and the shape disappears.

**Acceptance Criteria:**
- [ ] `originX` and `originY` are captured exactly once in `pointerdown` and are NEVER updated during `pointermove` or `pointerup`
- [ ] During `pointermove`, the draft element's bounding box is computed as:
  ```
  x = Math.min(originX, currentX)
  y = Math.min(originY, currentY)
  width = Math.abs(currentX - originX)
  height = Math.abs(currentY - originY)
  ```
- [ ] Rectangle tool: dragging from (500,500) to (200,200) leaves a visible 300x300 rectangle at (200,200)
- [ ] Rhombus tool: same coordinate normalization as rectangle, shape renders correctly in all 4 drag directions
- [ ] `SceneElement` `width` and `height` for closed shapes are NEVER negative
- [ ] Releasing the mouse after a reverse-direction draw leaves a stable, non-vanishing shape on the canvas
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Fix eraser cursor not following mouse during drag (P0/Critical)

**Description:** As a user, I want the eraser cursor icon to follow my mouse movement while dragging, so I always know where the eraser is positioned.

**Root Cause Analysis:** Browser native drag-and-drop behavior or CSS `cursor` property being removed during active drag causes the cursor to freeze at the initial position.

**Acceptance Criteria:**
- [ ] When `activeTool === 'eraser'`, the canvas container applies `cursor: url(eraser-icon), auto !important;` at all times
- [ ] The `:active` pseudo-class state also enforces the eraser cursor (does not revert to default)
- [ ] `pointerdown` on the canvas calls `e.preventDefault()` to suppress native text selection / drag-and-drop, provided it does not break touch interactions
- [ ] Eraser icon follows the mouse pixel-accurately during continuous drag at any speed
- [ ] Cursor does not freeze, flicker, or disappear at any point during the drag
- [ ] Releasing the mouse does not leave the eraser cursor stuck; it persists while eraser tool is active
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Implement viewport-center-based zoom algorithm (P1)

**Description:** As a user, I want zoom in/out to keep the center of my viewport anchored to the same world coordinates, so that my view doesn't fly away when I click the + / - buttons.

**Acceptance Criteria:**
- [ ] Zoom controller computes viewport center: `viewportCenterX = viewportWidth / 2`, `viewportCenterY = viewportHeight / 2`
- [ ] Converts viewport center to world coordinates using current zoom and scroll:
  ```
  worldX = (viewportCenterX - scrollX) / zoom
  worldY = (viewportCenterY - scrollY) / zoom
  ```
- [ ] After updating zoom, recalculates scroll to compensate:
  ```
  newScrollX = viewportCenterX - (worldX * newZoom)
  newScrollY = viewportCenterY - (worldY * newZoom)
  ```
- [ ] `newZoom`, `newScrollX`, `newScrollY` are applied atomically to AppState
- [ ] Drawing a square at viewport center, then repeatedly clicking `+` to zoom in, the square remains visually centered on screen at every zoom step
- [ ] Repeatedly clicking `-` to zoom out, the square also remains centered
- [ ] Mouse wheel zoom (if existing) follows the same center-based compensation logic
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Implement layer management core array logic with Undo/Redo (P2)

**Description:** As a developer, I need the layer ordering logic to correctly reorder elements in the `Scene.elements` array and push a history snapshot after each operation, so that Undo/Redo works correctly after layer changes.

**Core Design Principle:** Z-Index is determined solely by element index in the `elements` array -- higher index = rendered on top. Layer operations are array element movements.

**Acceptance Criteria:**
- [ ] **Bring to Front:** Selected element is `splice`-removed from its current index and `push`-appended to the end of the array
- [ ] **Send to Back:** Selected element is `splice`-removed and `unshift`-inserted at index 0
- [ ] **Bring Forward (up one layer):** Selected element at index `i` is swapped with element at index `i+1`
- [ ] **Send Backward (down one layer):** Selected element at index `i` is swapped with element at index `i-1`
- [ ] Each of the 4 operations triggers a full canvas redraw after the array mutation
- [ ] Each of the 4 operations pushes a complete state snapshot to the Undo/Redo history stack (same format as existing history snapshots)
- [ ] Undo after a layer operation correctly restores the previous element ordering
- [ ] Redo after undoing a layer operation correctly re-applies the ordering change
- [ ] Operations only apply when exactly ONE element is selected; multi-selection is rejected (no-op or ignored)
- [ ] Function exports 4 pure utility functions: `bringToFront(elements, selectedId)`, `sendToBack(elements, selectedId)`, `bringForward(elements, selectedId)`, `sendBackward(elements, selectedId)` -- each returns the mutated array
- [ ] Typecheck passes

### US-005: Add Layer management toolbar UI with button state machine (P2)

**Description:** As a user, I want 4 layer control buttons in the toolbar so I can adjust the stacking order of a selected shape with a single click.

**Acceptance Criteria:**
- [ ] New button group added to the toolbar second row, between the Style and Save sections, visually separated by `|` dividers on both sides
- [ ] Region labeled with title text "Layer"
- [ ] 4 icon buttons rendered: Bring Forward (up arrow), Send Backward (down arrow), Bring to Front (double up arrow / top), Send to Back (double down arrow / bottom)
- [ ] **Disabled state (grayed out, non-clickable)** when:
  - No element is selected (`selectedElementIds` is empty)
  - Multiple elements are selected (`selectedElementIds.length > 1`)
- [ ] **Boundary disabled state** when a single element is selected:
  - If element index === 0 (bottom-most): "Send Backward" and "Send to Back" are disabled
  - If element index === `elements.length - 1` (top-most): "Bring Forward" and "Bring to Front" are disabled
- [ ] Clicking an enabled button calls the corresponding US-004 utility function and triggers the redraw/history pipeline
- [ ] Button disabled states update reactively whenever `selectedElementIds` or `elements` array changes
- [ ] Visual feedback: buttons show hover/active states when enabled; disabled buttons have reduced opacity
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: `originX` / `originY` in `pointerdown` are immutable constants during a single draw gesture
- FR-2: All closed-shape draft elements use `Math.min` for position and `Math.abs` for dimensions during `pointermove`
- FR-3: Eraser cursor enforced via CSS `cursor` with `!important` on both normal and `:active` states of the canvas container
- FR-4: `e.preventDefault()` called in canvas `pointerdown` when `activeTool === 'eraser'`
- FR-5: Zoom uses viewport-center anchor algorithm; `zoom`, `scrollX`, `scrollY` updated atomically
- FR-6: Z-Index ordering is strictly determined by element array index (higher = on top)
- FR-7: Layer operations mutate the `elements` array via `splice`/`push`/`unshift`/swap
- FR-8: Every layer operation pushes a full state snapshot to Undo/Redo history
- FR-9: Layer buttons are only enabled for single-element selection within valid index bounds
- FR-10: Layer button group is placed between Style and Save on toolbar second row, separated by `|` dividers

---

## Non-Goals (Out of Scope)

- No layer panel / sidebar (e.g., Excalidraw-style layer list) -- only toolbar buttons
- No multi-select layer operations (e.g., moving an entire group up one layer) -- single selection only
- No layer locking or visibility toggling
- No nested layer groups / sub-layers
- No keyboard shortcuts for layer operations
- No animation/transitions for layer reordering

---

## Design Considerations

- Toolbar second-row layout: `[ Style ] | [ Layer: ↑ ↓ ⇈ ⇊ ] | [ Save ]`
- Button icons should follow common design conventions:
  - Bring Forward: single up arrow
  - Send Backward: single down arrow
  - Bring to Front: double up arrow or arrow pointing to top line
  - Send to Back: double down arrow or arrow pointing to bottom line
- Disabled buttons use the same visual style as other disabled toolbar buttons in v2.1.3
- Reuse existing toolbar button component from v2.1.3

---

## Technical Considerations

- Canvas coordinate system: world coordinates vs screen coordinates distinction must be maintained
- The `elements` array mutation must produce a new array reference (not in-place mutation) to trigger React/State reactivity if applicable
- History snapshot format must match the existing Undo/Redo implementation from v2.1.3
- Eraser icon file path needs to be converted to base64 data URI for reliable CSS `url()` usage
- Zoom algorithm must handle edge cases: zoom at minimum (0.1x) and maximum (5x) bounds

---

## Success Metrics

- Reverse-direction drawing: 0% failure rate across all 4 drag quadrants for rectangle and rhombus tools
- Eraser cursor: icon follows mouse at all times during drag, 0 reported cursor-freeze incidents
- Center zoom: viewport center point remains on the same world coordinate through any number of zoom steps
- Layer management: all 4 buttons work correctly; Undo/Redo produces correct state after any sequence of layer operations
- All existing v2.1.3 features (marquee selection, group/ungroup, resize handles) remain fully functional after these changes

---

## Execution Order (Strict Dependency Chain)

1. **US-001** (P0) - Fix reverse drawing -- must pass verification before any other US
2. **US-002** (P0) - Fix eraser cursor -- must pass verification before any other US
3. **US-003** (P1) - Center-based zoom -- depends on a stable canvas (US-001, US-002)
4. **US-004** (P2) - Layer core logic -- depends on stable canvas; implement and unit-test the array functions
5. **US-005** (P2) - Layer UI -- depends on US-004 being complete and tested

---

## Open Questions

- What is the exact file path and format (SVG/PNG) of the eraser icon? Does a base64 version already exist in the project?
- Does the existing Undo/Redo system use a deep-clone snapshot or an immutable state diff? This affects how layer operations push to history.
- Are there any existing CSS variables or design tokens for toolbar button disabled states that should be reused?
