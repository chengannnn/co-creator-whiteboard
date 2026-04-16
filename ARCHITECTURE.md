# Whiteboard Architecture (AI-Friendly)

> **Target audience**: AI coding assistants (Claude, Copilot, etc.) picking up this project.
> **Last updated**: 2026-04-17 (v2.1.9 — logical delete, undo upsert, redraw fix)
> **Branch**: `feature/whiteboard-v2.1.8`

---

## Project Overview

A real-time collaborative whiteboard app (Excalidraw-lite) built with **React + Vite** (frontend) and **Express + WebSocket** (backend), organized as an npm workspaces monorepo.

```
packages/
  frontend/          # React SPA — canvas, tools, state, rendering
  backend/           # Express + ws server — room management, state broadcast
archive/             # Old version backups (ignore)
tasks/               # Historical PRDs (ignore)
scripts/             # Utility scripts (ignore)
ralph/               # Ralph agent configs (ignore)
.claude/             # Claude Code settings (ignore)
```

---

## Directory Map (Core Packages)

### packages/frontend/src

| Path | Responsibility |
|------|---------------|
| `App.tsx` | **Root state owner** — all React state, WebSocket, history, scene refs |
| `main.tsx` | Entry point, wraps App in BrowserRouter |
| `types/element.ts` | **Data model** — SceneElement types, ToolHandler interface, DraftElement |
| `theme.ts` | Light/dark theme colors + stroke color inversion for dark mode |
| `components/CanvasComponent.tsx` | **Render engine + event pipeline** — 3-layer canvas, pointer events, tool dispatch |
| `components/UnifiedToolbar.tsx` | Top toolbar: tool buttons, color picker, style controls |
| `components/BottomPanel.tsx` | Bottom-right panel: room ID, share, user count, undo/redo, zoom |
| `components/RoomHeader.tsx` | (Legacy, unused — BottomPanel replaced it) |
| `core/Scene.ts` | **Scene graph** — element storage (Map), CRUD, grouping |
| `core/HistoryManager.ts` | **Undo/Redo** — snapshot-based, delegates to Scene |
| `core/transform.ts` | **Coordinate math** — screenToWorld, worldToScreen, zoomFromCenter |
| `core/hitTesting.ts` | **Hit detection** — point-in-bbox, rect-intersect, marquee select, interpolatePoints |
| `core/layerUtils.ts` | **Z-ordering** — bringToFront, sendToBack, bringForward, sendBackward |
| `core/tools/index.ts` | Re-exports all tool handlers |
| `core/tools/helpers.ts` | generateElementId, createBaseElement, createDraft |
| `core/tools/RectangleHandler.ts` | BBox tool handler (rectangle/ellipse/rhombus) |
| `core/tools/LineHandler.ts` | Line tool handler (line/arrow) |
| `core/tools/FreehandHandler.ts` | Freehand tool handler |
| `core/tools/EraserHandler.ts` | Eraser tool handler (object-level, stroke interpolation) |
| `core/tools/SelectToolHandler.ts` | Select tool handler (hit, move, resize, 8-point handles) |

### packages/backend/src

| Path | Responsibility |
|------|---------------|
| `index.ts` | Express + WebSocket server — room management, shape broadcast, cursor relay |

---

## Core Architecture

### 1. State Management (AppState)

**Owner**: `App.tsx` — single source of truth.

All state lives in `WhiteboardRoom` component as React `useState` and `useRef`:

| State | Type | Where used |
|-------|------|------------|
| `sceneRef` | `useRef<Scene>` | Canvas rendering, tool handlers, hit testing |
| `historyRef` | `useRef<HistoryManager>` | Undo/redo, tied to Scene |
| `wsRef` | `useRef<WebSocket>` | Real-time sync, cursor broadcast |
| `activeTool` | `useState<ToolType>` | Toolbar, CanvasComponent |
| `selectedIds` | `useState<string[]>` | Selection UI, move/resize, layer ops |
| `panX/panY` | `useState<number>` | Canvas transform (scroll) |
| `scale` | `useState<number>` | Canvas zoom level |
| `defaultStyle` | `useState` | Stroke/fill defaults for new elements |
| `locked` | `useState<boolean>` | Canvas lock (pan-only mode) |
| `themeMode` | `useState<'light'\|'dark'>` | Theme colors, stroke inversion |

**Critical**: `Scene` and `HistoryManager` are stored in `useRef`, **not** `useState`. They mutate internally without triggering React re-renders. Canvas redraws are triggered explicitly via `renderStaticScene()` / `renderInteractive()` calls, not via React state changes.

### 2. Data Model: Scene & Elements

**Definition**: `types/element.ts`

```
SceneElement (union type)
  └── BaseElement          # common fields
       ├── id: string
       ├── type: ElementType
       ├── x, y, width, height: number
       ├── angle: number
       ├── strokeColor, fillColor: string
       ├── strokeWidth: 1 | 2 | 4
       ├── strokeStyle: 'solid' | 'dashed'
       ├── fillStyle: 'none' | 'solid' | 'hatch'
       ├── opacity: number
       ├── version: number
       ├── versionNonce: number
       ├── isDeleted: boolean     # LOGICAL deletion, NOT physical removal
       ├── groupIds: string[]
       ├── index: number          # Z-order key
       ├── updated: number
       └── ownerId: string
  └── Type-specific extensions:
       ├── RectangleElement: borderRadius?
       ├── EllipseElement: (none)
       ├── RhombusElement: borderRadius?
       ├── LineElement: points[], startArrowhead?, endArrowhead?
       ├── ArrowElement: points[], startArrowhead?, endArrowhead (required)
       ├── FreehandElement: points[]
       ├── TextElement: content, fontSize, fontFamily, textAlign, verticalAlign, lineHeight
       └── ImageElement: src, fileId
```

**DraftElement** = `{ element: SceneElement, isDraft: true }` — used during drawing before commit.

### 3. Scene Graph

**File**: `core/Scene.ts`

- Internal storage: `Map<string, SceneElement>` (O(1) lookup by ID).
- `getElements()` → filters `!isDeleted`, sorts by `index` ascending.
- **Z-order**: determined by `index` field. Array position in `getElements()` result = render order.
- `deleteElement()` → sets `isDeleted: true`, does **NOT** remove from Map.
- `replaceAll()` → clears Map, re-inserts all elements.
- `snapshot()` → deep clone via `structuredClone` — includes logically deleted elements (unlike `getElements()`).
- `groupElements()` / `ungroupElements()` → shared `groupIds` array.

### 4. Canvas Render Engine & Layers

**File**: `components/CanvasComponent.tsx`

Three-layer canvas architecture (stacked with `position: absolute`):

| Layer | ID | Purpose | Redraw trigger |
|-------|----|---------|----------------|
| **Layer 0** | `bgCanvasRef` | Solid background fill | Theme change, resize |
| **Layer 1** | `staticCanvasRef` | All committed SceneElements via native Canvas 2D `drawShape()` | Scene change, pan, zoom, theme |
| **Layer 2** | `interactiveCanvasRef` | Draft elements, selection boxes, resize handles, remote cursors, eraser ring | Every pointer move during drawing/selecting |

**`drawShape()`** (line ~469): single dispatch function that renders any `SceneElement` using native Canvas 2D. Switches on `element.type` and calls `ctx.fillRect`, `ctx.ellipse`, `ctx.stroke`, etc. **No rough.js**.

**Transform application**: `ctx.setTransform(scale, 0, 0, scale, panX, panY)` applied before rendering elements.

### 5. Pointer Events & Tools

**File**: `components/CanvasComponent.tsx` (lines ~1486-1937)

Unified pipeline on `interactiveCanvasRef` via `onPointerDown` / `onPointerMove` / `onPointerUp`:

```
PointerDown
  ├── locked?     → only pan allowed
  ├── eraser      → createEraserHandler, mode='drawing'
  ├── middle-click / space+drag → pan, mode='panning'
  ├── drawing tool → createDrawingHandler (ToolHandler), mode='drawing'
  └── select tool
       ├── resize handle hit → mode='resizing'
       ├── element hit       → mode='moving' (group auto-select)
       └── empty hit         → mode='selecting' (marquee)

PointerMove
  ├── drawing  → handler.onPointerMove + redraw interactive layer
  ├── moving   → delta-translate all selected elements, onMoveElements()
  ├── resizing → applyResize(), onMoveElements()
  ├── panning  → update panXRef/panYRef, redraw all 3 layers
  └── selecting → update marqueeEnd, redraw interactive layer

PointerUp
  ├── drawing  → handler.onPointerUp → commitElement() or discard
  ├── eraser   → finish() → set isDeleted=true on hits → onSceneMutate('delete') → redrawCanvas()
  ├── move/resize → history.push(), update all → onSceneMutate('update')
  ├── panning  → commit pan to React state
  └── selecting → findElementsInRect → setSelectedIds
```

**ToolHandler Interface** (`types/element.ts:111-127`):
```
onPointerDown(worldX, worldY, setDraft)
onPointerMove(worldX, worldY, draft, setDraft)
onPointerUp(draft, commitElement) → SceneElement | null
```

Factory functions in `core/tools/`:
- `createBBoxHandler(type, style)` → rectangle/ellipse/rhombus
- `createLineHandler(type, style, options)` → line/arrow
- `createFreehandHandler(style)` → freehand
- `createEraserHandler(getElements)` → eraser
- `createSelectToolHandler(...)` → select (separate, no DraftElement)

### 6. WebSocket Communication

**Backend**: `packages/backend/src/index.ts`
**Frontend**: `App.tsx` (lines ~120-234 for connection, ~114-292 for mutations)

**Protocol** (JSON over WebSocket):

| Message | Direction | Payload | Effect |
|---------|-----------|---------|--------|
| `join_room` | C→S | `{ roomId }` | Join room, receive full state |
| `sync_state` | S→C | `{ shapes[] }` | Full canvas sync (legacy Shape format) |
| `user_identity` | S→C | `{ color, name }` | Assign user identity |
| `user_count` | S→C | `{ count }` | Update user count |
| `shape_create` | C→S / S→C | `{ shape, userId }` | New element broadcast |
| `shape_update` | C→S / S→C | `{ shape }` | Element update broadcast |
| `shape_delete` | C→S / S→C | `{ shapeId }` | Element delete broadcast |
| `cursor_position` | C→S / S→C | `{ userId, x, y, color, name, isDrawing }` | Live cursor relay |
| `cursor_leave` | S→C | `{ userId }` | Remove remote cursor |

**Key detail**: `shape_delete` uses **logical deletion** — backend sets `isDeleted: true` via `findIndex`, never `filter()`. This preserves undo history.

**Data format split**:

- **`sync_state`** → server sends **legacy Shape format** (nested `style` object, `startX/startY/endX/endY`). Client converts via `shapeToElement()` once on initial sync.
- **Incremental mutations** (`shape_create`, `shape_update`, `shape_delete`) → client sends and receives **new SceneElement format** (flat `strokeColor`/`strokeWidth`/`strokeStyle`/`fillStyle`/`fillColor`, no nested `style`). The `shape_create` / `shape_update` payload key is `shape` (not `element`), and `shape_delete` uses `shapeId` (not `elementId`).
- **No double-conversion**: incremental mutation receivers use `msg.shape` directly as `SceneElement`. The `shapeToElement()` function has a defensive guard — if the input already has `version` + `strokeColor` + no `style` (i.e., it's already a SceneElement), it returns it unchanged. This protects against page-refresh re-syncs delivering new-format data through the legacy converter.
- **Force redraw on `shape_update`**: after `scene.updateElement()` in the `shape_update` receiver, `canvasRef.current?.redraw()` is called to force the canvas to repaint. Since `Scene.updateElement` mutates in-place (useRef, not useState), no React re-render is triggered without this explicit call.

**Key detail**: Server stores shapes in legacy `Shape` format (`{ id, type, x, y, width, height, startX, endX, ... }`). Client converts via `shapeToElement()` on `sync_state`, but sends/receives `SceneElement` format on incremental mutations.

**Reconnection**: Exponential backoff (500ms → 5s max).

---

## Coordinate System

**File**: `core/transform.ts`

```
Screen → World:  worldX = (screenX - scrollX) / zoom
World → Screen:  screenX = worldX * zoom + scrollX
```

- `panX/panY` in React state = `scrollX/scrollY` in transform math.
- `scale` in React state = `zoom` in transform math.
- `screenToWorld()` / `worldToScreen()` are the two conversion functions.
- `zoomFromCenter()` keeps the **viewport center point** anchored to the same world coordinates during zoom.

---

## Key Architecture Decisions (IRON RULES)

> **These are non-negotiable constraints. Violating them introduces regressions.**

### Rule 1: No rough.js — Native Canvas 2D Only

- All geometric rendering uses **native Canvas 2D** API (`ctx.fillRect`, `ctx.ellipse`, `ctx.moveTo/lineTo/stroke`, `ctx.quadraticCurveTo`).
- The `drawShape()` function in `CanvasComponent.tsx` handles all element types via a `switch` statement.
- **Do NOT** add rough.js, rough-canvas, or any sketch-style rendering library.

### Rule 2: Coordinate System for Closed Shapes vs Vector Lines

**Closed shapes** (rectangle, ellipse, rhombus):
- `pointermove` must keep `originX`/`originY` **constant** — captured in a closure at `pointerdown` time (`let originX = worldX; let originY = worldY;`).
- **Do NOT** use `el.x`/`el.y` for width/height calculation — these get overwritten on every `setDraft`, causing the origin to drift and breaking left/up drag directions.
- Use `Math.min(originX, current)` for `x,y` and `Math.abs(current - originX)` for `width,height`.
- See `RectangleHandler.ts:26-51` for the correct pattern.

**Vector lines** (line, arrow):
- `originX/Y` is the anchor point. The second endpoint is stored as relative offset in `points[1]`.
- `width/height` = `Math.abs(dx)` / `Math.abs(dy)` (for bounding box purposes).
- **Do NOT** apply the `Math.min/Math.abs` absolute-position logic to line/arrow coordinates — their `points` array defines the geometry relative to `x,y`.

### Rule 3: Zoom — Step 0.1 + Viewport-Center Compensation

- Zoom step = **0.1** (`ZOOM_STEP = 0.1`).
- Zoom range: **0.1 to 5** (`MIN_ZOOM = 0.1`, `MAX_ZOOM = 5`).
- **Must** use `zoomFromCenter()` from `transform.ts` to compute compensatory `scrollX/scrollY` so that the viewport center point remains anchored.
- Direct manipulation of `scale` without corresponding `panX/panY` compensation will cause visual jumps.

### Rule 4: Logical Deletion + Z-Index via Array Order

- Deletion = `isDeleted: true`. **Never** `delete` or `splice` elements from the Scene Map.
- Z-index = `Scene.elements` sorted by `index` field (ascending).
- Layer ordering utilities (`bringToFront`, `sendToBack`, etc.) in `layerUtils.ts` mutate `index` and re-sort.
- Hit testing iterates **in reverse** (`elements.length - 1` down to `0`) to get top-most element first.

### Rule 5: Grouping & Ungrouping Data Integrity

- **Grouping**: Assign a new `crypto.randomUUID()` to the `groupIds` array of all selected elements. **Do not** change their `index` (Z-order). See `Scene.ts:groupElements()`.
- **Ungrouping**: Remove **ONLY** the top-level shared `groupId` via `groupIds.filter(g => g !== groupId)`. Preserve any nested `groupIds` and **strictly preserve** the `index` (Z-order) of every element. See `Scene.ts:ungroupElements()`.
- Ungrouping must be allowed even if only **1 orphaned element** is selected, as long as it carries a valid `groupId`.
- **Implementation**: `Scene.groupElements()` / `Scene.ungroupElements()` handle the data layer; `CanvasComponent.tsx` `useImperativeHandle` exposes the UI-facing methods plus `redraw()` (calls `redrawAllRef.current?.()` — repaints all 3 canvas layers).

### Rule 6: UI Modifier State Machine (e.g., Sharp/Round Corners)

Toolbar attribute modifiers (Corners, Colors, Styles) must support a **Dual-Behavior Mode**:
- **Global Preset Mode**: Enabled when `activeTool` is a compatible drawing tool (e.g., rectangle/rhombus) — applies to *future* shapes.
- **Modifier Mode**: Enabled when `activeTool === 'select'` AND `selectedElements` contains at least one compatible shape — applies to *existing* shapes.
- **Do NOT** blindly disable modifiers just because the user switched to the Selection tool. The button must remain active if either condition is true.
- **Implementation**: See `App.tsx:573-607` — `isRoundCapableTool` (Condition A) and `hasSelectedShapes` (Condition B) are OR-ed to determine button enabled state.

### Rule 7: SVG-Only Toolbar Icons

- **Never** use Unicode characters (e.g., `○`, `◇`, `▭`, `✎`) or standard text fonts for toolbar icons. They render inconsistently across OS font stacks and break exact bounding-box alignment.
- **All** toolbar icons must be pure `<svg>` components with explicit `viewBox` and `<path>` definitions.
- **Implementation**: v2.1.8 replaced all Unicode tool icons with inline SVG components in `UnifiedToolbar.tsx`. Any new tool button added to the toolbar must follow this pattern.

### Rule 8: Logical Delete — Never Physically Remove Elements

- **Backend**: `shape_delete` in `packages/backend/src/index.ts` must mark `isDeleted: true` on the matching shape. **Never** `filter()` or `splice()` shapes from the `roomShapes` Map. This ensures Undo can restore elements.
- **Backend upsert**: `shape_update` must add the shape via `push()` if `findIndex` returns `-1`. This is critical for Undo restoring elements that the backend no longer has a record of.
- **Frontend**: `Scene.deleteElement()` sets `isDeleted: true`. `Scene.getElements()` filters out deleted elements but they remain in the internal Map.
- **Eraser**: Calls `onSceneMutate('delete')` (not `'update'`) after setting `isDeleted: true` on hit elements, so the correct WebSocket broadcast path fires.

### Rule 9: Snapshot for ReplaceAll Sync

- In `onSceneMutate` with `action === 'replaceAll'` (Undo/Redo), use `scene.snapshot()` — which returns **all** elements including logically deleted ones — as the broadcast data source, not `scene.getElements()`. This ensures that undoing an erasure or re-deleting restored shapes syncs correctly across devices.
- `shapeToElement` preserves `isDeleted` via `shape.isDeleted ?? false` in the `commonBase` object.
- `shape_update` receiver on the frontend calls `canvasRef.current?.redraw()` to force canvas refresh, since `scene.updateElement` mutates in-place without triggering React re-render.

---

## Event Flow Summary

```
User interaction
  → interactiveCanvasRef (pointer event)
    → getWorldPoint() converts screen → world coords
      → dispatch by activeTool:
        ├── ToolHandler.onPointerDown/Move/Up  (drawing tools)
        ├── SelectToolHandler                  (select tool)
        ├── EraserHandler                      (eraser)
        └── Pan logic                          (space/middle-click)
          → scene.addElement/updateElement/deleteElement
          → history.push()
          → onSceneMutate() → WebSocket broadcast
          → renderStaticScene() + renderInteractive()

Remote mutation (WebSocket)
  → ws.onmessage dispatches:
        ├── shape_create  → scene.addElement() + setShapeOwners
        ├── shape_update  → scene.updateElement() + canvasRef.redraw() (force repaint)
        ├── shape_delete  → scene.deleteElement() + clear selection/ownership
        └── sync_state    → scene.replaceAll(shapes.map(shapeToElement)) + history.clear()
          → (no explicit redraw needed — React state change triggers re-render)
```

---

## Backend Room Lifecycle

1. Client connects via WebSocket → assigned random color + animal name.
2. Client sends `join_room` → server adds to room Set, sends `sync_state` (all shapes).
3. Room shape state is stored server-side in `roomShapes` Map (`roomId → Shape[]`).
4. **Grace period cleanup**: When a room becomes empty (0 clients), its shape data is **NOT** immediately deleted. Instead, `scheduleRoomCleanup(roomId)` starts a **5-minute countdown timer**. Only after this timer fires are the shapes purged from `roomShapes`. This allows users to reconnect within 5 minutes and recover their canvas state.
5. **Cursor cleanup on room switch**: When a user switches from room A to room B via `join_room`, the server first calls `broadcastCursorLeave(roomA, ws)` to remove the stale cursor from room A's other participants. This prevents cursor ghosting.
6. **Cursor cleanup on disconnect**: When a WebSocket closes, the server calls `broadcastCursorLeave(currentRoom, ws)` before removing the client from the room Set.
7. Shape mutations (`shape_create/update/delete`) are persisted in `roomShapes` Map and broadcast to all other clients in the room.
   - `shape_create` → `shapes.push(msg.shape)`.
   - `shape_update` → `findIndex` by ID; if found, replace; if **not found**, `push()` (upsert — supports Undo restoring elements the backend doesn't have).
   - `shape_delete` → `findIndex` by ID; sets `isDeleted: true` on the shape. **Never** `filter()` / physical removal.
8. Server is stateless between restarts — no database.

### Cleanup Flow

```
Room becomes empty (clients.size === 0)
  → scheduleRoomCleanup(roomId)  // starts 5-min timer
  → rooms.delete(roomId)         // room entry removed immediately
  → roomShapes KEPT               // shapes preserved during grace period
  → [5 minutes elapse]
  → cleanup timer fires
  → roomShapes.delete(roomId)    // shapes finally purged
  → rooms already gone
```

### Key Safety Rules

- **NEVER** call `roomShapes.delete(roomId)` synchronously when a room becomes empty. Always route through `scheduleRoomCleanup`.
- **ALWAYS** call `broadcastCursorLeave(roomId, ws)` before removing a client from a room (both on disconnect and on room switch).
- **NEVER** physically delete shapes from `roomShapes` via `filter()` or `splice()`. Use `findIndex` + set `isDeleted: true` for deletion; use upsert (`push` when not found) for `shape_update`.
