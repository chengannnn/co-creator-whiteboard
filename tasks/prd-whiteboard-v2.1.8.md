# PRD: Whiteboard v2.1.8 — Toolbar Layout Refactor & Icon Visual Balancing

## 1. Introduction

v2.1.8 is a UI/UX polish iteration focused on two areas:

1. **Toolbar layout reorganization** — Reorder the buttons in the first row of the `UnifiedToolbar` to follow a logical "Tools → Properties → Actions → Media" grouping, with visual dividers between each group.
2. **Icon visual balancing** — Replace Unicode character icons with proper SVG components so that Circle and Solid Circle icons can be precisely sized to match the visual weight of Rhombus and other shape icons.

**Files affected:**
- `packages/frontend/src/components/UnifiedToolbar.tsx` — primary target
- `packages/frontend/src/theme.ts` — reference only (divider colors already exist)

## 2. Goals

- Reorder Row 1 right-side buttons to: **Eraser | Sharp + Round Corner | Group + Ungroup | Insert Image**
- Insert vertical dividers between each logical group, reusing the existing divider style
- Replace all Unicode tool icons in the `TOOLS` array with SVG components for consistent cross-platform rendering
- Adjust Circle SVG geometry so its visual diameter matches Rhombus diagonal width
- Ensure all changes work correctly in both light and dark themes

## 3. User Stories

### US-001: Replace Unicode Icons with SVG Components
**Description:** As a developer, I want all tool icons to use SVG instead of Unicode characters so that rendering is consistent across Windows, Mac, and Linux.

**Acceptance Criteria:**
- [ ] Create SVG icon components for: Rectangle, Rectangle Solid, Ellipse (Circle), Ellipse Solid (Solid Circle), Rhombus, Rhombus Solid, Line, Arrow
- [ ] All SVG icons use the same standard: `width="18"`, `height="18"`, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="2"`, `strokeLinecap="round"`, `strokeLinejoin="round"`
- [ ] Eraser icon remains unchanged (already an SVG component)
- [ ] Update the `TOOLS` array to reference the new SVG components instead of Unicode strings
- [ ] The icon rendering logic in the button (`typeof tool.icon === 'function' ? <tool.icon /> : tool.icon`) must work correctly for all tools — since all icons are now functions, simplify the rendering to always use `<tool.icon />`
- [ ] Typecheck passes

### US-002: Visually Balance Circle Icons to Match Rhombus
**Description:** As a user, I want the Circle and Solid Circle icons to appear the same visual size as the Rhombus icon so the toolbar feels balanced.

**Acceptance Criteria:**
- [ ] Ellipse (Circle) SVG uses an adjusted `<circle>` `r` value that makes its visual diameter match the Rhombus outline's diagonal width
- [ ] Ellipse Solid (Solid Circle) SVG uses the same adjusted `r` value, with `fill="currentColor"` in addition to `stroke="currentColor"`
- [ ] Both circle icons use `r="9"` or greater (current effective radius at r=7 is visually smaller than Rhombus diagonal spanning ~17px within the viewBox)
- [ ] The active/disabled state color mapping still works correctly (currentColor-based coloring must not break)
- [ ] Typecheck passes

### US-003: Reorder Toolbar Buttons and Insert Dividers
**Description:** As a user, I want the toolbar buttons to follow a logical grouping (Tools → Properties → Actions → Media) separated by dividers so I can find the right tool faster.

**Current Row 1 order (after Select + Divider):**
`[TOOLS map: Rect → Rect-Solid → Ellipse → Ellipse-Solid → Rhombus → Rhombus-Solid → Line → Arrow → Pencil → Eraser]` → `[Divider]` → `Image` → `SharpCorner` → `RoundCorner` → `Group` → `Ungroup`

**New Row 1 order (after Select + Divider):**
`[TOOLS map: Rect → Rect-Solid → Ellipse → Ellipse-Solid → Rhombus → Rhombus-Solid → Line → Arrow → Pencil → Eraser]` → `[Divider 1]` → `SharpCorner` → `RoundCorner` → `[Divider 2]` → `Group` → `Ungroup` → `[Divider 3]` → `Image`

**Acceptance Criteria:**
- [ ] Eraser remains in the `TOOLS` array as the last item — no data structure change
- [ ] A divider (`theme.divider`, 1px wide, 24px tall) is rendered immediately after the `TOOLS.map()` rendering block (between Eraser and SharpCorner)
- [ ] SharpCorner and RoundCorner are adjacent to each other with no divider between them
- [ ] A divider is rendered between RoundCorner and Group
- [ ] Group and Ungroup are adjacent to each other with no divider between them
- [ ] A divider is rendered between Ungroup and Insert Image
- [ ] Insert Image is now the rightmost button in Row 1
- [ ] All dividers reuse the existing inline style pattern: `{ width: '1px', height: '24px', backgroundColor: theme.divider, margin: '0 4px', flexShrink: 0 }`
- [ ] Divider colors render correctly in both light (`#f0e4c0`) and dark (`#444444`) modes
- [ ] Typecheck passes

## 4. Functional Requirements

- **FR-1:** Create 8 new SVG icon components (Rectangle, Rectangle-Solid, Ellipse, Ellipse-Solid, Rhombus, Rhombus-Solid, Line, Arrow) in `UnifiedToolbar.tsx` following the existing pattern used by `EraserIcon`, `GroupIcon`, etc.
- **FR-2:** Ellipse and Ellipse-Solid SVGs must use `<circle>` with an increased `r` value (recommended: `r="9"`) to match Rhombus visual weight
- **FR-3:** Solid variants (Rectangle-Solid, Ellipse-Solid, Rhombus-Solid) must use `fill="currentColor"` to render as filled shapes
- **FR-4:** The `TOOLS` array `icon` field must reference SVG component functions (not strings) for all items
- **FR-5:** Reorder Row 1 JSX to place dividers between: Eraser↔SharpCorner, RoundCorner↔Group, Ungroup↔Image
- **FR-6:** All dividers must use `theme.divider` for color, ensuring light/dark mode compatibility

## 5. Non-Goals (Out of Scope)

- No changes to Row 2 (Colors, Width, Style, Layer, Save, Theme toggle)
- No new tools or features added
- No changes to canvas rendering logic (shapes drawn on canvas remain unchanged)
- No changes to keyboard shortcuts or tool behavior
- No changes to the Group/Ungroup logic or state machine

## 6. Design Considerations

### Existing Divider Pattern
The project already uses inline dividers throughout Row 2. The canonical pattern is:
```tsx
<div style={{ width: '1px', height: '20px', backgroundColor: theme.divider }} />
```
For Row 1, use `height: '24px'` and `margin: '0 4px'` to match the taller button row. The `theme.divider` value is:
- Light mode: `#f0e4c0`
- Dark mode: `#444444`

### SVG Icon Standards
All icons in the toolbar follow these conventions:
- Dimensions: `18x18` outer, `viewBox="0 0 24 24"`
- Stroke: `currentColor` with `strokeWidth="2"`, `strokeLinecap="round"`, `strokeLinejoin="round"`
- Fill: `none` for outline shapes, `currentColor` for solid shapes
- Color inheritance via `currentColor` ensures active/disabled/disabled states work automatically through the button's `color` CSS property

### Circle vs Rhombus Visual Weight
The Rhombus outline icon currently uses a diamond shape with points at approximately (12,3), (21,12), (12,21), (3,12), giving a diagonal span of ~18px. A circle with `r="7"` (diameter 14px) appears smaller. Increasing to `r="9"` (diameter 18px) brings the circle's diameter in line with the rhombus diagonal.

## 7. Technical Considerations

- All new SVG components should be added at the top of `UnifiedToolbar.tsx` alongside existing icon components (after line 75, before line 84)
- The `TOOLS` array (lines 105-116) must be updated to use function references instead of string literals for icons
- The icon rendering in the button template (line 448) should be simplified since all icons will now be functions — the ternary `typeof tool.icon === 'function'` check can be removed
- Row 1 reordering involves moving JSX blocks: the current Image button (line 463), SharpCorner (line 494), RoundCorner (line 533), Group (line 576), Ungroup (line 611) need to be rearranged with dividers inserted between groups
- No changes needed to `theme.ts` — the divider color already supports both themes

## 8. Success Metrics

- All toolbar buttons in Row 1 render with consistent SVG icons (no Unicode characters)
- Circle and Rhombus icons appear visually equal in size
- Button order matches: `[Drawing Tools] | [Corner Modifiers] | [Group/Ungroup] | [Image]`
- No visual regressions in dark mode
- No TypeScript errors

## 9. Open Questions

- None — all requirements are clarified and implementation details are specified.
