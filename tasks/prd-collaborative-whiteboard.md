# PRD: Online Collaborative Whiteboard MVP

## Overview

Build a minimal viable product (MVP) of an online collaborative whiteboard application similar to [Excalidraw](https://excalidraw.com/). Users should be able to open a shared room, draw basic shapes and freehand lines, and see each other's cursors in real-time.

### Target Users
- Remote teams doing brainstorming sessions
- Developers sketching architecture diagrams together
- Teachers and students in virtual classrooms

### Non-Goals (MVP)
- User authentication / accounts
- Image imports / exports
- Export to PNG/SVG (save via URL share only)
- Mobile/tablet touch optimization
- Infinite canvas zoom & pan (basic only)
- Version history / undo beyond local undo
- End-to-end encryption

---

## Architecture Choices

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | React + Vite + TypeScript | Fast dev, widely used, type safety |
| Canvas | HTML5 Canvas (via rough.js) | Hand-drawn aesthetic, performant |
| State | Zustand | Lightweight, simple API |
| Real-time | WebSocket (ws + Node server) | Bidirectional, low latency |
| Styling | TailwindCSS | Rapid UI development |
| Backend | Node.js + Express + ws | Simple, single language with frontend |

---

## User Stories

### Story 1: Project Scaffolding

**As a** developer
**I want** a working monorepo with frontend and backend
**So that** I can start building features

**Acceptance Criteria:**
- [ ] Monorepo structure with `packages/frontend` and `packages/backend`
- [ ] Vite + React + TypeScript dev server runs on port 5173
- [ ] Node.js + Express server runs on port 3001
- [ ] TypeScript strict mode enabled
- [ ] `npm run dev` starts both frontend and backend concurrently
- [ ] ESLint configured with basic rules
- [ ] Root `package.json` with workspace configuration

### Story 2: Canvas with Basic Drawing Tools

**As a** user
**I want** to draw rectangles, ellipses, and freehand lines on a canvas
**So that** I can sketch ideas visually

**Acceptance Criteria:**
- [ ] Full-screen canvas area with white background
- [ ] Toolbar on the left side with tool buttons: Select, Rectangle, Ellipse, Freehand (Pencil)
- [ ] Click and drag to draw rectangles and ellipses
- [ ] Freehand drawing follows mouse/pen movement
- [ ] Shapes render with a hand-drawn aesthetic (rough.js)
- [ ] Selected tool is visually highlighted in toolbar
- [ ] Drawing works smoothly at 60fps

### Story 3: Shape Selection and Manipulation

**As a** user
**I want** to select, move, resize, and delete shapes
**So that** I can refine my diagrams

**Acceptance Criteria:**
- [ ] Clicking a shape selects it (shows bounding box with resize handles)
- [ ] Dragging a selected shape moves it
- [ ] Dragging resize handles resizes the shape proportionally
- [ ] Pressing Delete/Backspace removes the selected shape
- [ ] Clicking empty canvas deselects
- [ ] Multi-select is NOT required for MVP (future)
- [ ] Undo (Ctrl+Z) works for the last action

### Story 4: Shape Styling

**As a** user
**I want** to change the stroke color, fill color, and stroke width of shapes
**So that** I can make my diagrams more expressive

**Acceptance Criteria:**
- [ ] Properties panel (top bar) shows styling options when a shape is selected
- [ ] Color picker with at least 8 preset colors + custom color
- [ ] Stroke width selector: thin (1px), medium (2px), thick (4px)
- [ ] Fill toggle: none, solid, hatch
- [ ] Stroke style: solid, dashed
- [ ] Changes apply immediately to the selected shape
- [ ] Default stroke color: black (#000000)
- [ ] Default stroke width: 2px
- [ ] Default fill: none

### Story 5: Text Tool

**As a** user
**I want** to add text labels to my whiteboard
**So that** I can annotate my diagrams

**Acceptance Criteria:**
- [ ] Text tool in toolbar
- [ ] Clicking canvas with text tool creates an editable text field
- [ ] Typing creates text; pressing Enter or clicking away finishes editing
- [ ] Text can be selected, moved, and styled like other shapes
- [ ] Default font: system sans-serif, 20px
- [ ] Text can be resized via handles
- [ ] Text content is stored in the shape data model

### Story 6: Room-Based Collaboration

**As a** user
**I want** to create or join a shared whiteboard room via URL
**So that** multiple people can collaborate

**Acceptance Criteria:**
- [ ] Visiting `/` generates a unique room ID and redirects to `/room/:roomId`
- [ ] Visiting `/room/:roomId` joins that room
- [ ] Room ID is a short, readable string (e.g., `a3f7k2`)
- [ ] A "Share" button copies the room URL to clipboard
- [ ] Current user count is displayed (e.g., "3 users online")
- [ ] When the last user leaves, the room is cleaned up after 5 minutes

### Story 7: Real-Time Shape Sync

**As a** user
**I want** to see shapes created by other users appear on my canvas in real-time
**So that** we can collaborate simultaneously

**Acceptance Criteria:**
- [ ] When a user creates/updates/deletes a shape, all other users in the room see the change within 200ms
- [ ] WebSocket connects on room join, sends full canvas state
- [ ] Delta updates are broadcast (not full state re-sync) for each mutation
- [ ] Concurrent edits from multiple users are merged without conflicts (last-write-wins is acceptable for MVP)
- [ ] Network disconnect triggers a "Reconnecting..." banner; reconnect re-syncs full state
- [ ] Shapes from other users are attributed visually (colored border matching their cursor)

### Story 8: Live Cursor Presence

**As a** user
**I want** to see other users' cursors moving on the canvas with their names
**So that** I can follow what others are doing

**Acceptance Criteria:**
- [ ] Each user is assigned a random color and a random name (e.g., "Purple Fox")
- [ ] Other users' cursors are rendered as colored pointers with name labels
- [ ] Cursor position updates are throttled to 30fps via WebSocket
- [ ] Cursor disappears when user leaves the room
- [ ] When a user is drawing, their cursor shows a small pencil indicator
- [ ] Cursor names do not overlap with shapes (render on top layer)

### Story 9: Canvas Pan and Zoom

**As a** user
**I want** to pan around and zoom in/out of the canvas
**So that** I can work on large diagrams

**Acceptance Criteria:**
- [ ] Mouse wheel zooms in/out centered on cursor
- [ ] Middle-click drag or space+drag pans the canvas
- [ ] Zoom range: 10% to 500%
- [ ] Zoom level indicator in bottom-right corner
- [ ] Double-click on empty canvas resets zoom to 100% and centers view
- [ ] All shapes render correctly at all zoom levels
- [ ] Pan/zoom state is NOT shared between users (each user has their own viewport)

---

## Data Model

### Shape (Base)
```typescript
interface Shape {
  id: string;              // UUID
  type: 'rectangle' | 'ellipse' | 'freehand' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: 1 | 2 | 4;
  strokeStyle: 'solid' | 'dashed';
  fillStyle: 'none' | 'solid' | 'hatch';
  roughness: number;       // 0-2, passed to rough.js
  deleted: boolean;
  version: number;         // increment on each edit
  groupId?: string;        // future: for grouping
}

interface FreehandShape extends Shape {
  type: 'freehand';
  points: [number, number][];  // relative to shape x,y
}

interface TextShape extends Shape {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
}
```

### Room State
```typescript
interface Room {
  id: string;
  shapes: Map<string, Shape>;
  users: Map<string, User>;
  lastActivity: Date;
}

interface User {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number };
  activeTool: string;
}
```

### WebSocket Messages
```typescript
type WSMessage =
  | { type: 'join'; roomId: string; userId: string }
  | { type: 'shape-create'; shape: Shape }
  | { type: 'shape-update'; shape: Shape }
  | { type: 'shape-delete'; shapeId: string }
  | { type: 'cursor-move'; x: number; y: number; tool: string }
  | { type: 'user-leave'; userId: string }
  | { type: 'room-state'; shapes: Shape[]; users: User[] }
  | { type: 'user-count'; count: number };
```

---

## UI Layout

```
+----------------------------------------------------------+
|  [Properties Bar]  Color: ███  Stroke: ▬▬  Fill: ◻  ... |
+--------+-------------------------------------------------+
| Select |                                                 |
|  ┌─┐  |                                                 |
| Rect |                                                 |
|  ◯   |              CANVAS AREA                          |
|Ellipse|                                                  |
|  ✏️  |                                                  |
| Text |                                                  |
|  ↶   |                                                  |
| Undo |                                                  |
+--------+                                                 |
| [Share] Room: abc123  |  3 users  |  Zoom: 100%         |
+----------------------------------------------------------+
```

---

## Acceptance Criteria for MVP Release

- [ ] A new user can visit the app, get a room URL, share it, and start drawing
- [ ] Two users in the same room can draw simultaneously and see each other's work
- [ ] Cursor presence shows who is where on the canvas
- [ ] All 5 user stories are functionally complete
- [ ] The app works in Chrome, Firefox, and Safari (latest versions)
- [ ] No critical console errors
- [ ] Page loads in under 3 seconds on a standard connection

---

## Stretch Goals (Post-MVP)

- Image paste/drag-drop onto canvas
- Export to PNG/SVG
- Arrow/line connector tool with snap-to-shape
- Shape grouping/ungrouping
- Layer ordering (bring to front / send to back)
- Local persistence (auto-save to localStorage)
- Mobile touch support
- Whiteboard templates
- Undo/redo history (full stack, not just local)
