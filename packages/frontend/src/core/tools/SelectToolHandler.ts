import type { Point } from '../../types/element';
import type { Shape } from '../../types/shapes';

export type SelectMode = 'idle' | 'hit' | 'moving' | 'resizing';

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

interface SelectState {
  mode: SelectMode;
  selectedId: string | null;
  activeHandle: ResizeHandle | null;
  moveOffset: Point;
  resizeStartBounds: { x: number; y: number; width: number; height: number };
  startWorld: Point;
}

function createInitialState(): SelectState {
  return {
    mode: 'idle',
    selectedId: null,
    activeHandle: null,
    moveOffset: { x: 0, y: 0 },
    resizeStartBounds: { x: 0, y: 0, width: 0, height: 0 },
    startWorld: { x: 0, y: 0 },
  };
}

const HANDLE_SIZE = 8;
const BBOX_PADDING = 6;

/**
 * Compute bounding box of a shape in world coordinates (local copy to avoid circular dependency).
 */
function getShapeBounds(shape: Shape): { x: number; y: number; width: number; height: number } {
  if (shape.type === 'freehand') {
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (shape.type === 'line' || shape.type === 'arrow') {
    return {
      x: Math.min(shape.startX, shape.endX),
      y: Math.min(shape.startY, shape.endY),
      width: Math.abs(shape.endX - shape.startX),
      height: Math.abs(shape.endY - shape.startY),
    };
  }
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

/**
 * SelectToolHandler — manages hit-testing, selection, move, and resize.
 *
 * Unlike drawing handlers, this does not create new DraftElements.
 * Instead, it tracks the interaction state internally and communicates
 * via callbacks (onSelectionChange).
 */
export function createSelectToolHandler(
  getShapes: () => Shape[],
  getSelectedIds: () => string[],
  onSelectionChange: (ids: string[]) => void,
  onMove: (shapes: Shape[]) => void,
  getScale: () => number,
): {
  onPointerDown: (worldX: number, worldY: number) => void;
  onPointerMove: (worldX: number, worldY: number) => void;
  onPointerUp: () => Shape[] | null;
  getMode: () => SelectMode;
} {
  const state: SelectState = createInitialState();
  let moveShapes: Shape[] | null = null;

  function getBBox(shape: Shape) {
    const b = getShapeBounds(shape);
    return {
      x: b.x - BBOX_PADDING,
      y: b.y - BBOX_PADDING,
      width: b.width + BBOX_PADDING * 2,
      height: b.height + BBOX_PADDING * 2,
    };
  }

  function getHandlePositions(bbox: { x: number; y: number; width: number; height: number }) {
    const half = HANDLE_SIZE / 2;
    return {
      nw: { x: bbox.x - half, y: bbox.y - half },
      ne: { x: bbox.x + bbox.width - half, y: bbox.y - half },
      sw: { x: bbox.x - half, y: bbox.y + bbox.height - half },
      se: { x: bbox.x + bbox.width - half, y: bbox.y + bbox.height - half },
      n: { x: bbox.x + bbox.width / 2 - half, y: bbox.y - half },
      s: { x: bbox.x + bbox.width / 2 - half, y: bbox.y + bbox.height - half },
      e: { x: bbox.x + bbox.width - half, y: bbox.y + bbox.height / 2 - half },
      w: { x: bbox.x - half, y: bbox.y + bbox.height / 2 - half },
    };
  }

  function hitTestHandles(point: Point): ResizeHandle | null {
    const primaryId = state.selectedId;
    if (!primaryId) return null;
    const shapes = getShapes();
    const selected = shapes.find((s) => s.id === primaryId);
    if (!selected) return null;
    const bbox = getBBox(selected);
    const handles = getHandlePositions(bbox);
    const scaledHandleSize = HANDLE_SIZE / getScale();

    for (const [handle, pos] of Object.entries(handles)) {
      if (
        point.x >= pos.x &&
        point.x <= pos.x + scaledHandleSize &&
        point.y >= pos.y &&
        point.y <= pos.y + scaledHandleSize
      ) {
        return handle as ResizeHandle;
      }
    }
    return null;
  }

  function hitTestShapes(point: Point): Shape | null {
    const shapes = getShapes();
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      const bounds = getShapeBounds(shape);

      if (shape.type === 'freehand') {
        // Point-in-polygon approximation
        const pts = shape.points;
        let inside = false;
        for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
          const xi = pts[j].x,
            yi = pts[j].y;
          const xk = pts[k].x,
            yk = pts[k].y;
          if (yi > point.y !== yk > point.y && point.x < ((xk - xi) * (point.y - yi)) / (yk - yi) + xi) {
            inside = !inside;
          }
        }
        if (inside) return shape;
      } else {
        if (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        ) {
          return shape;
        }
      }
    }
    return null;
  }

  function applyResize(
    shape: Shape,
    handle: ResizeHandle,
    dx: number,
    dy: number,
  ): Shape {
    const bounds = getShapeBounds(shape);
    let { x, y, width, height } = bounds;

    switch (handle) {
      case 'se':
        width += dx;
        height += dy;
        break;
      case 'sw':
        x += dx;
        width -= dx;
        height += dy;
        break;
      case 'ne':
        width += dx;
        y += dy;
        height -= dy;
        break;
      case 'nw':
        x += dx;
        y += dy;
        width -= dx;
        height -= dy;
        break;
      case 'n':
        y += dy;
        height -= dy;
        break;
      case 's':
        height += dy;
        break;
      case 'e':
        width += dx;
        break;
      case 'w':
        x += dx;
        width -= dx;
        break;
    }

    if (width < 10) {
      x -= 10 - width;
      width = 10;
    }
    if (height < 10) {
      y -= 10 - height;
      height = 10;
    }

    if (shape.type === 'freehand') {
      const origBounds = getShapeBounds(shape);
      const offX = x - origBounds.x;
      const offY = y - origBounds.y;
      return {
        ...shape,
        points: shape.points.map((p) => ({ x: p.x + offX, y: p.y + offY })),
      };
    }
    if (shape.type === 'line' || shape.type === 'arrow') {
      const origBounds = getShapeBounds(shape);
      const offX = x - origBounds.x;
      const offY = y - origBounds.y;
      return {
        ...shape,
        startX: shape.startX + offX,
        startY: shape.startY + offY,
        endX: shape.endX + offX,
        endY: shape.endY + offY,
      };
    }
    return { ...shape, x, y, width, height };
  }

  return {
    onPointerDown(worldX: number, worldY: number): void {
      const point = { x: worldX, y: worldY };
      state.startWorld = point;

      // Check resize handle hit first
      const handle = hitTestHandles(point);
      const selectedIds = getSelectedIds();
      const primaryId = selectedIds[selectedIds.length - 1];

      if (handle && primaryId) {
        const shapes = getShapes();
        const shape = shapes.find((s) => s.id === primaryId);
        if (shape) {
          const bounds = getShapeBounds(shape);
          state.resizeStartBounds = { ...bounds };
          state.activeHandle = handle;
          state.selectedId = primaryId;
          state.mode = 'resizing';
          moveShapes = null;
        }
        return;
      }

      // Check shape hit
      const hitShape = hitTestShapes(point);
      if (hitShape) {
        onSelectionChange([hitShape.id]);
        const bounds = getShapeBounds(hitShape);
        state.moveOffset = { x: worldX - bounds.x, y: worldY - bounds.y };
        state.selectedId = hitShape.id;
        state.mode = 'moving';
        moveShapes = null;
      } else {
        onSelectionChange([]);
        state.selectedId = null;
        state.mode = 'hit';
      }
    },

    onPointerMove(worldX: number, worldY: number): void {
      const shapes = getShapes();

      if (state.mode === 'moving' && state.selectedId) {
        const selectedIds = getSelectedIds();
        const selectedIdSet = new Set(selectedIds);
        const currentShapes = moveShapes ?? shapes;

        const primaryShape = currentShapes.find((s) => s.id === state.selectedId);
        if (!primaryShape) return;

        const bounds = getShapeBounds(primaryShape);
        const newX = worldX - state.moveOffset.x;
        const newY = worldY - state.moveOffset.y;
        const dx = newX - bounds.x;
        const dy = newY - bounds.y;

        if (dx === 0 && dy === 0) return;

        const newShapes = currentShapes.map((s) => {
          if (!selectedIdSet.has(s.id)) return s;
          if (s.type === 'freehand') {
            return {
              ...s,
              points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            };
          }
          if (s.type === 'line' || s.type === 'arrow') {
            return {
              ...s,
              startX: s.startX + dx,
              startY: s.startY + dy,
              endX: s.endX + dx,
              endY: s.endY + dy,
            };
          }
          return { ...s, x: s.x + dx, y: s.y + dy };
        });

        moveShapes = newShapes;
        onMove(newShapes);
        return;
      }

      if (state.mode === 'resizing' && state.selectedId && state.activeHandle) {
        const currentShapes = moveShapes ?? shapes;
        const shape = currentShapes.find((s) => s.id === state.selectedId);
        if (!shape) return;

        const orig = state.resizeStartBounds;
        const dx = worldX - (orig.x + (state.activeHandle!.includes('e') ? orig.width : 0));
        const dy = worldY - (orig.y + (state.activeHandle!.includes('s') ? orig.height : 0));

        const resized = applyResize(shape, state.activeHandle!, dx, dy);
        const newShapes = currentShapes.map((s) => (s.id === state.selectedId ? resized : s));

        moveShapes = newShapes;
        onMove(newShapes);
        return;
      }
    },

    onPointerUp(): Shape[] | null {
      const result = moveShapes;
      moveShapes = null;
      state.mode = 'idle';
      state.activeHandle = null;
      return result;
    },

    getMode(): SelectMode {
      return state.mode;
    },
  };
}
