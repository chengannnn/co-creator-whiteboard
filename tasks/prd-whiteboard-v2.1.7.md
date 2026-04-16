# PRD: Whiteboard v2.1.7 - Corner Modifier State Fix & Icon Redesign

## Introduction

Whiteboard v2.1.7 fixes a critical UX bug in the corner modifier (Sharp/Round Corner) buttons and improves their visual clarity. The bug causes the buttons to be incorrectly disabled when the user selects existing shapes with the Selection tool, preventing attribute modification. The icon redesign replaces full-shape symbols with precise 1/4 corner symbols for better semantic meaning.

**Branch:** `feature/whiteboard-v2.1.7`

---

## Goals

- Fix the corner modifier buttons so they are usable when selecting existing shapes with the Selection tool
- Replace Sharp/Round Corner icons with semantically precise 1/4 corner symbols (stroke-based SVGs)
- Ensure all visual states (active, inactive, hover, disabled) work correctly with the new icons

---

## User Stories

### US-001: Fix corner modifier buttons disabled during shape selection (P0/Critical)

**Description:** As a user, I want the Sharp/Round Corner buttons to be usable when I select existing rectangle/rhombus shapes with the Selection tool, so I can modify their corner style without having to re-select the drawing tool.

**Root Cause Analysis:** The current `canRoundCorner` logic in `UnifiedToolbar.tsx` (line ~184) only checks `activeTool`:

```typescript
const canRoundCorner = activeTool === 'rectangle' || activeTool === 'rectangle-solid' || activeTool === 'rhombus' || activeTool === 'rhombus-solid';
```

When the user switches to the Selection tool (`activeTool === 'select'`) and clicks on an existing rectangle/rhombus shape, `canRoundCorner` becomes `false` because the active tool is no longer a drawing tool. This disables both corner buttons, making it impossible to modify existing shapes' `borderRadius`.

**Acceptance Criteria:**
- [ ] Rename `canRoundCorner` to `isCornerModifierEnabled` and change its logic from AND (only activeTool check) to OR (activeTool check OR selection-based check)
- [ ] The new OR logic: button is enabled if EITHER condition is true:
  - **Condition A (Global Preset):** `activeTool` is one of `rectangle`, `rectangle-solid`, `rhombus`, `rhombus-solid` (existing logic)
  - **Condition B (Attribute Modifier):** `activeTool === 'select'` AND `selectedElements.length > 0` AND at least one selected element has `type === 'rectangle'` or `type === 'rhombus'`
- [ ] When Condition B is met and the user clicks Sharp Corner, iterate through selected elements, find eligible ones (rectangle/rhombus), set their `borderRadius` to 0, push history snapshot, call `onSceneMutate('update')`
- [ ] When Condition B is met and the user clicks Round Corner, same flow but set `borderRadius` to 12
- [ ] The Sharp/Round Corner button visual active state correctly reflects the current `isRoundCornerEnabled` value regardless of whether Condition A or Condition B triggered the enabled state
- [ ] Switching between Selection tool and drawing tools does not cause the button states to flicker or lose sync with the actual shape data
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Replace corner modifier icons with 1/4 corner SVGs (P1)

**Description:** As a user, I want the Sharp/Round Corner icons to show just the corner symbol (not the full shape), so I can more quickly understand what each button controls.

**Acceptance Criteria:**
- [ ] **SharpCornerIcon** replaced with a 1/4 square corner (L-shaped right angle at top-left): SVG path `M 8 16 L 8 8 L 16 8` on a `viewBox="0 0 24 24"`, `strokeWidth="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, centered in the viewBox
- [ ] **RoundCornerIcon** replaced with a 1/4 circular arc (curved corner at top-left): SVG path `M 8 16 A 8 8 0 0 1 16 8` on a `viewBox="0 0 24 24"`, `strokeWidth="2"`, `stroke-linecap="round"`, centered in the viewBox
- [ ] Icons use `currentColor` for stroke color so they inherit the button's text color in active/hover/disabled states
- [ ] No fill on the SVG paths (stroke-only, `fill="none"`)
- [ ] Active state (highlighted border/background) displays correctly when the respective corner mode is active
- [ ] Disabled state (opacity 0.4, color muted) displays correctly when neither Condition A nor Condition B is met
- [ ] Hover state shows background color change consistently with other toolbar buttons
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: `isCornerModifierEnabled` is computed as `conditionA || conditionB` where conditionA checks activeTool and conditionB checks selected element types
- FR-2: Condition B requires `activeTool === 'select'` AND `selectedElements.length > 0` AND at least one selected element is `rectangle` or `rhombus` type
- FR-3: Sharp Corner click modifies `borderRadius` to 0 for all eligible selected shapes
- FR-4: Round Corner click modifies `borderRadius` to 12 for all eligible selected shapes
- FR-5: Corner modifier clicks push a history snapshot and call `onSceneMutate('update')`
- FR-6: SharpCornerIcon is a 1/4 square L-shape stroke SVG (`M 8 16 L 8 8 L 16 8`)
- FR-7: RoundCornerIcon is a 1/4 circle arc stroke SVG (`M 8 16 A 8 8 0 0 1 16 8`)
- FR-8: Both icons use `currentColor`, `fill="none"`, `strokeWidth="2"` for consistent theming

---

## Non-Goals (Out of Scope)

- No changes to the existing Round Corner / Sharp Corner toggle behavior (mutual exclusion logic stays as-is from v2.1.6)
- No changes to the `borderRadius` rendering logic in CanvasComponent (already correct: uses `isRoundCornerEnabled ? 12 : 0`)
- No new drawing tools or shape types
- No keyboard shortcuts for corner modifier buttons
- No changes to other toolbar buttons or layout

---

## Design Considerations

- The 1/4 corner icons should be visually centered within the 24x24 viewBox, which the provided SVG paths achieve naturally
- The L-shape for Sharp Corner (⌜) and arc for Round Corner (╭) both anchor at the top-left corner, creating visual symmetry between the two
- The stroke-only design (no fill) ensures the icons remain clear and lightweight at the 18x18 rendered size used in the toolbar

---

## Technical Considerations

- The `canRoundCorner` variable in `UnifiedToolbar.tsx` is currently used for both the Round Corner and Sharp Corner buttons (they share the same enabled/disabled condition). The fix should update this single variable to cover both
- The `handleRoundCornerToggle` callback in `App.tsx` already iterates through `selectedIds` to find eligible shapes. It needs no changes for the bug fix — only the `canRoundCorner` → `isCornerModifierEnabled` condition computation needs to change
- The `selectedElements` prop passed to `UnifiedToolbar` from `App.tsx` already contains the full `SceneElement[]` for the current selection — no additional data fetching is needed
- Ensure the icon replacement does not accidentally change the button's `width`/`height` or positioning in the toolbar layout

---

## Success Metrics

- Sharp/Round Corner buttons are usable in both "drawing tool active" and "selection tool with shapes selected" scenarios
- Users can modify corner style of existing shapes with 1 click without needing to re-select the drawing tool
- New 1/4 corner icons are visually distinct and semantically clear at a glance
- Zero regression in existing Round Corner / Sharp Corner toggle behavior

---

## Execution Order

1. **US-001** (P0) - Fix corner modifier enabled state logic — critical bug, must be done first
2. **US-002** (P1) - Replace icons with 1/4 corner SVGs — standalone visual improvement, no dependency on US-001

---

## Open Questions

- Should the corner modifier buttons also show a subtle "mixed" state (e.g., partially highlighted) when selected elements have inconsistent `borderRadius` values (some round, some sharp)?
- Should the Sharp Corner button also be available for text elements with rounded backgrounds (if such a feature exists)?
