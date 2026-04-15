import type { SceneElement, Point } from '../../types/element';

export type SelectMode = 'idle' | 'hit' | 'moving' | 'resizing';

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

interface SelectState {
  mode: SelectMode;
  selectedId: string | null;
  activeHandle: ResizeHandle | null;
  moveOffset: Point;
  startWorld: Point;
}

function createInitialState(): SelectState {
  return {
    mode: 'idle',
    selectedId: null,
    activeHandle: null,
    moveOffset: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
  };
}

const HANDLE_SIZE = 8;
const BBOX_PADDING = 6;

/**
 * Compute bounding box of a SceneElement in world coordinates.
 */
function getElementBounds(el: SceneElement): { x: number; y: number; width: number; height: number } {
  if (el.type === 'freehand' || el.type === 'line' || el.type === 'arrow') {
    const pts = el.points;
    if (pts.length === 0) return { x: el.x, y: el.y, width: 0, height: 0 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x: el.x + Math.min(...xs),
      y: el.y + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/**
 * SelectToolHandler — manages hit-testing, selection, move, and resize.
 *
 * Unlike drawing handlers, this does not create new DraftElements.
 * Instead, it tracks the interaction state internally and communicates
 * via callbacks (onSelectionChange).
 *
 * Works with SceneElement (not legacy Shape types).
 */
export function createSelectToolHandler(
  getElements: () => SceneElement[],
  getSelectedIds: () => string[],
  onSelectionChange: (ids: string[]) => void,
  onMove: (elements: SceneElement[]) => void,
  getScale: () => number,
): {
  onPointerDown: (worldX: number, worldY: number) => void;
  onPointerMove: (worldX: number, worldY: number) => void;
  onPointerUp: () => SceneElement[] | null;
  getMode: () => SelectMode;
} {
  const state: SelectState = createInitialState();
  let moveElements: SceneElement[] | null = null;

  function getBBox(el: SceneElement) {
    const b = getElementBounds(el);
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
    const elements = getElements();
    const selected = elements.find((el) => el.id === primaryId);
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

  function hitTestElements(point: Point): SceneElement | null {
    const elements = getElements();
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const bounds = getElementBounds(el);

      if (el.type === 'freehand') {
        // Point-in-polygon approximation
        const pts = el.points;
        let inside = false;
        for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
          const xi = pts[j].x, yi = pts[j].y;
          const xk = pts[k].x, yk = pts[k].y;
          if (yi > point.y !== yk > point.y && point.x < ((xk - xi) * (point.y - yi)) / (yk - yi) + xi) {
            inside = !inside;
          }
        }
        if (inside) return el;
      } else {
        if (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        ) {
          return el;
        }
      }
    }
    return null;
  }

  function applyResize(
    el: SceneElement,
    handle: ResizeHandle,
    mouseX: number,
    mouseY: number,
  ): SceneElement {
    const bounds = getElementBounds(el);
    let { x, y, width, height } = bounds;

    const MIN_DIM = 5;

    switch (handle) {
      case 'se': {
        // Lock top-left corner, recalculate width/height from mouse
        width = Math.max(mouseX - x, MIN_DIM);
        height = Math.max(mouseY - y, MIN_DIM);
        break;
      }
      case 'sw': {
        // Lock bottom-right corner, recalculate x/width from mouse
        const right = x + width;
        x = Math.min(mouseX, right - MIN_DIM);
        width = right - x;
        height = Math.max(mouseY - y, MIN_DIM);
        break;
      }
      case 'ne': {
        // Lock bottom-left corner, recalculate y/height and width from mouse
        const left = x;
        const bottom = y + height;
        width = Math.max(mouseX - left, MIN_DIM);
        y = Math.min(mouseY, bottom - MIN_DIM);
        height = bottom - y;
        break;
      }
      case 'nw': {
        // Lock bottom-right corner, recalculate x/y/width/height from mouse
        const right = x + width;
        const bottom = y + height;
        x = Math.min(mouseX, right - MIN_DIM);
        y = Math.min(mouseY, bottom - MIN_DIM);
        width = right - x;
        height = bottom - y;
        break;
      }
      case 'n': {
        // Lock bottom edge, recalculate y/height from mouse
        const bottom = y + height;
        y = Math.min(mouseY, bottom - MIN_DIM);
        height = bottom - y;
        break;
      }
      case 's': {
        // Lock top edge, recalculate height from mouse
        height = Math.max(mouseY - y, MIN_DIM);
        break;
      }
      case 'e': {
        // Lock left edge, recalculate width from mouse
        width = Math.max(mouseX - x, MIN_DIM);
        break;
      }
      case 'w': {
        // Lock right edge, recalculate x/width from mouse
        const right = x + width;
        x = Math.min(mouseX, right - MIN_DIM);
        width = right - x;
        break;
      }
    }

    if (el.type === 'freehand') {
      const origBounds = getElementBounds(el);
      const offX = x - origBounds.x;
      const offY = y - origBounds.y;
      return {
        ...el,
        points: el.points.map((p) => ({ x: p.x + offX, y: p.y + offY })),
      };
    }
    if (el.type === 'line' || el.type === 'arrow') {
      const origBounds = getElementBounds(el);
      const offX = x - origBounds.x;
      const offY = y - origBounds.y;
      return {
        ...el,
        x: el.x + offX,
        y: el.y + offY,
      };
    }
    return { ...el, x, y, width, height };
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
        const elements = getElements();
        const el = elements.find((e) => e.id === primaryId);
        if (el) {
          state.activeHandle = handle;
          state.selectedId = primaryId;
          state.mode = 'resizing';
          moveElements = null;
        }
        return;
      }

      // Check element hit
      const hitEl = hitTestElements(point);
      if (hitEl) {
        onSelectionChange([hitEl.id]);
        const bounds = getElementBounds(hitEl);
        state.moveOffset = { x: worldX - bounds.x, y: worldY - bounds.y };
        state.selectedId = hitEl.id;
        state.mode = 'moving';
        moveElements = null;
      } else {
        onSelectionChange([]);
        state.selectedId = null;
        state.mode = 'hit';
      }
    },

    onPointerMove(worldX: number, worldY: number): void {
      const elements = getElements();

      if (state.mode === 'moving' && state.selectedId) {
        const selectedIds = getSelectedIds();
        const selectedIdSet = new Set(selectedIds);
        const currentElements = moveElements ?? elements;

        const primaryEl = currentElements.find((el) => el.id === state.selectedId);
        if (!primaryEl) return;

        const bounds = getElementBounds(primaryEl);
        const newX = worldX - state.moveOffset.x;
        const newY = worldY - state.moveOffset.y;
        const dx = newX - bounds.x;
        const dy = newY - bounds.y;

        if (dx === 0 && dy === 0) return;

        const newElements = currentElements.map((el) => {
          if (!selectedIdSet.has(el.id)) return el;
          if (el.type === 'freehand') {
            return {
              ...el,
              points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            };
          }
          // Line/arrow/other elements: move x/y
          return { ...el, x: el.x + dx, y: el.y + dy };
        });

        moveElements = newElements;
        onMove(newElements);
        return;
      }

      if (state.mode === 'resizing' && state.selectedId && state.activeHandle) {
        const currentElements = moveElements ?? elements;
        const el = currentElements.find((e) => e.id === state.selectedId);
        if (!el) return;

        const resized = applyResize(el, state.activeHandle, worldX, worldY);
        const newElements = currentElements.map((e) => (e.id === state.selectedId ? resized : e));

        moveElements = newElements;
        onMove(newElements);
        return;
      }
    },

    onPointerUp(): SceneElement[] | null {
      const result = moveElements;
      moveElements = null;
      state.mode = 'idle';
      state.activeHandle = null;
      return result;
    },

    getMode(): SelectMode {
      return state.mode;
    },
  };
}
