import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Scene } from '../core/Scene';
import { HistoryManager } from '../core/HistoryManager';
import { findElementsInRect } from '../core/hitTesting';
import { zoomFromCenter } from '../core/transform';
import { bringToFront, sendToBack, bringForward, sendBackward } from '../core/layerUtils';
import type { SceneElement, DraftElement, StrokeWidth, ToolHandler as ToolHandlerType, Point, RectangleElement, RhombusElement, Arrowhead } from '../types/element';
import { getThemeColors, getStrokeColor, type ThemeMode } from '../theme';
import {
  createBBoxHandler,
  createLineHandler,
  createFreehandHandler,
  createEraserHandler,
} from '../core/tools';

// Map solid tool variants to base shape types for drawing/hit-testing logic
const getBaseShapeTool = (tool: string): string => {
  if (tool === 'rectangle-solid') return 'rectangle';
  if (tool === 'ellipse-solid') return 'ellipse';
  if (tool === 'rhombus-solid') return 'rhombus';
  return tool;
};

// Map hex colors to readable names for cursor labels
const HEX_TO_COLOR_NAME: Record<string, string> = {
  '#ef4444': 'Red',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#06b6d4': 'Cyan',
  '#3b82f6': 'Blue',
  '#8b5cf6': 'Purple',
  '#ec4899': 'Pink',
  '#14b8a6': 'Teal',
  '#f43f5e': 'Rose',
  '#6366f1': 'Indigo',
  '#84cc16': 'Lime',
};

const HANDLE_SIZE = 8;
const BBOX_PADDING = 6;

export interface CanvasComponentRef {
  exportPng: () => void;
  undo: () => void;
  redo: () => void;
  groupSelectedElements: () => void;
  ungroupSelectedElements: (groupId: string) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  redraw: () => void;
}

interface CanvasComponentProps {
  scene: Scene;
  history: HistoryManager;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  userId: string | null;
  shapeOwners: Map<string, string>;
  remoteCursors: Map<string, { userId: string; x: number; y: number; color: string; name: string; isDrawing: boolean }>;
  broadcastCursor: (x: number, y: number, isDrawing: boolean) => void;
  panX: number;
  panY: number;
  scale: number;
  onPanXChange: (panX: number) => void;
  onPanYChange: (panY: number) => void;
  onScaleChange: (scale: number) => void;
  eraserRadius: number;
  locked: boolean;
  themeMode: ThemeMode;
  activeTool: string;
  defaultStyle: {
    strokeColor: string;
    strokeWidth: StrokeWidth;
    strokeStyle: 'solid' | 'dashed';
    fillStyle: 'none' | 'solid' | 'hatch';
    fillColor: string;
  };
  /** Called after each committed scene mutation. Triggers history + WebSocket broadcast. */
  onSceneMutate: (action: 'add' | 'update' | 'delete' | 'replaceAll' | 'clear') => void;
  /** Called to apply intermediate move/resize results (updates scene + triggers mutate) */
  onMoveElements: (elements: SceneElement[]) => void;
  isRoundCornerEnabled: boolean;
}

export default forwardRef<CanvasComponentRef, CanvasComponentProps>(function CanvasComponent({
  scene,
  history,
  selectedIds,
  onSelectedIdsChange,
  userId,
  shapeOwners,
  remoteCursors,
  broadcastCursor,
  panX,
  panY,
  scale,
  onPanXChange,
  onPanYChange,
  onScaleChange,
  eraserRadius,
  locked,
  themeMode,
  activeTool,
  defaultStyle,
  onSceneMutate,
  onMoveElements,
  isRoundCornerEnabled,
}: CanvasComponentProps, ref) {
  const theme = getThemeColors(themeMode);
  // Three-layer canvas references
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  // Interaction state
  const [interactionMode, setInteractionMode] = useState<'idle' | 'drawing' | 'selecting' | 'moving' | 'resizing' | 'panning'>('idle');
  const [activeHandle, setActiveHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null>(null);

  // Inline text editing state
  const [editingText, setEditingText] = useState<{
    shapeId: string;
    x: number;
    y: number;
    content: string;
    fontSize: number;
    isNew?: boolean;
  } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Pan/zoom refs
  const spacePressed = useRef(false);
  const isMiddleButton = useRef(false);
  const isPanning = useRef(false);
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const zoomCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Intermediate elements during move/resize
  const moveElementsRef = useRef<SceneElement[] | null>(null);
  const moveOffset = useRef<Point>({ x: 0, y: 0 });
  const resizeStartBounds = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Image cache
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Object-level eraser handler
  const eraserHandlerRef = useRef<ReturnType<typeof createEraserHandler> | null>(null);
  const mousePos = useRef<Point>({ x: 0, y: 0 });

  // Draft element for ToolHandler-based drawing
  const draftRef = useRef<DraftElement | null>(null);
  const activeHandlerRef = useRef<ToolHandlerType | null>(null);

  // Marquee selection state
  const marqueeStart = useRef<Point | null>(null);
  const marqueeEnd = useRef<Point | null>(null);

  // Refs for render callbacks (used in useImperativeHandle before render functions are defined)
  const redrawAllRef = useRef<(() => void) | null>(null);
  const renderStaticSceneRef = useRef<(() => void) | null>(null);
  const renderInteractiveRef = useRef<(() => void) | null>(null);

  // Keep refs in sync with props
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

  // Redraw all layers when zoom/pan state changes
  useEffect(() => {
    renderStaticScene();
    renderInteractive();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, panX, panY]);

  // Redraw all layers when theme changes (background color, stroke inversion, etc.)
  useEffect(() => {
    renderBackground();
    renderStaticScene();
    renderInteractive();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeMode]);

  // --- Scene helpers ---

  const undo = useCallback(() => {
    if (history.undo()) {
      onSelectedIdsChange([]);
      renderStaticScene();
      renderInteractive();
      onSceneMutate('replaceAll');
    }
  }, [history, onSelectedIdsChange, onSceneMutate]);

  const redo = useCallback(() => {
    if (history.redo()) {
      onSelectedIdsChange([]);
      renderStaticScene();
      renderInteractive();
      onSceneMutate('replaceAll');
    }
  }, [history, onSceneMutate]);

  // --- Pan/Zoom helpers ---

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 5;
  const ZOOM_STEP = 0.1;

  const applyCanvasTransform = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(scale, 0, 0, scale, panX, panY);
    },
    [panX, panY, scale]
  );

  const applyCanvasTransformFromRefs = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, panXRef.current, panYRef.current);
    },
    []
  );

  // --- Helper functions (must be before redraw functions) ---

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
    if (el.type === 'text' && el.width === 0 && el.height === 0) {
      return { x: el.x, y: el.y, width: 100, height: el.fontSize };
    }
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }

  const getBBox = useCallback((el: SceneElement | null) => {
    if (!el) return null;
    const b = getElementBounds(el);
    return {
      x: b.x - BBOX_PADDING,
      y: b.y - BBOX_PADDING,
      width: b.width + BBOX_PADDING * 2,
      height: b.height + BBOX_PADDING * 2,
    };
  }, []);

  const getHandlePositions = useCallback((bbox: { x: number; y: number; width: number; height: number }) => {
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
  }, []);

  /**
   * Computes the union bounding box of all elements sharing a groupId.
   */
  const getGroupBBox = useCallback((groupId: string) => {
    const elements = scene.getElements();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;
    for (const el of elements) {
      if (el.groupIds.includes(groupId)) {
        const b = getElementBounds(el);
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.width > maxX) maxX = b.x + b.width;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
        found = true;
      }
    }
    if (!found) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [scene]);

  /**
   * Returns the set of unique groupIds shared by ALL selected elements.
   * Only returns a groupId if every selected element has it.
   */
  const getSelectedGroupIds = useCallback((): string[] => {
    if (selectedIds.length === 0) return [];
    const elements = scene.getElements();
    // Collect all groupIds from the first selected element
    const firstEl = elements.find((e) => e.id === selectedIds[0]);
    if (!firstEl || firstEl.groupIds.length === 0) return [];
    // Filter to only groupIds that ALL selected elements share
    return firstEl.groupIds.filter((gid) =>
      selectedIds.every((id) => {
        const el = elements.find((e) => e.id === id);
        return el && el.groupIds.includes(gid);
      }),
    );
  }, [scene, selectedIds]);

  // Expose export, undo, redo functions to parent via ref
  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const elements = scene.getElements();
      if (elements.length === 0) return;

      // Compute minimum bounding box of all elements
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const el of elements) {
        const bounds = getElementBounds(el);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      }

      const padding = 20;
      const exportWidth = maxX - minX + padding * 2;
      const exportHeight = maxY - minY + padding * 2;

      // Create offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = exportWidth;
      offscreen.height = exportHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      // Background matching current theme
      ctx.fillStyle = theme.canvasBg;
      ctx.fillRect(0, 0, exportWidth, exportHeight);

      // Apply transform: shift content so minX-padding maps to 0
      ctx.setTransform(1, 0, 0, 1, -minX + padding, -minY + padding);

      // Render all elements
      for (const el of elements) {
        drawShape(ctx, el, themeMode);
      }

      // Draw colored borders on remote elements
      for (const el of elements) {
        const ownerId = shapeOwners.get(el.id);
        if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
          const bounds = getElementBounds(el);
          const borderColor = ownerId.split('-')[0] ?? '#8b5cf6';
          ctx.save();
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
          ctx.restore();
        }
      }

      // Download
      offscreen.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const roomId = window.location.pathname.split('/').pop() || 'unknown';
        a.download = `whiteboard-${roomId}-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
    },
    undo,
    redo,
    groupSelectedElements: () => {
      if (selectedIds.length < 2) return;
      history.push();
      scene.groupElements(selectedIds);
      onSceneMutate('update');
      renderStaticSceneRef.current?.();
      renderInteractiveRef.current?.();
    },
    ungroupSelectedElements: (groupId: string) => {
      if (selectedIds.length === 0) return;
      const elements = scene.getElements();
      let targetGroupId: string | undefined = groupId;
      if (!targetGroupId) {
        const firstEl = elements.find((e) => e.id === selectedIds[0]);
        if (!firstEl || firstEl.groupIds.length === 0) return;
        targetGroupId = firstEl.groupIds.find((gid) =>
          selectedIds.every((id) => {
            const el = elements.find((e) => e.id === id);
            return el && el.groupIds.includes(gid);
          }),
        );
      }
      if (!targetGroupId) return;
      history.push();
      scene.ungroupElements(selectedIds, targetGroupId);
      onSceneMutate('update');
      renderStaticSceneRef.current?.();
      renderInteractiveRef.current?.();
    },
    bringToFront: () => {
      if (selectedIds.length !== 1) return;
      history.push();
      const elements = scene.getElements();
      bringToFront(elements, selectedIds[0]);
      scene.replaceAll(elements);
      onSceneMutate('update');
      renderStaticSceneRef.current?.();
      renderInteractiveRef.current?.();
    },
    sendToBack: () => {
      if (selectedIds.length !== 1) return;
      history.push();
      const elements = scene.getElements();
      sendToBack(elements, selectedIds[0]);
      scene.replaceAll(elements);
      onSceneMutate('update');
      renderStaticSceneRef.current?.();
      renderInteractiveRef.current?.();
    },
    bringForward: () => {
      if (selectedIds.length !== 1) return;
      history.push();
      const elements = scene.getElements();
      bringForward(elements, selectedIds[0]);
      scene.replaceAll(elements);
      onSceneMutate('update');
      renderStaticSceneRef.current?.();
      renderInteractiveRef.current?.();
    },
    sendBackward: () => {
      if (selectedIds.length !== 1) return;
      history.push();
      const elements = scene.getElements();
      sendBackward(elements, selectedIds[0]);
      scene.replaceAll(elements);
      onSceneMutate('update');
      renderStaticSceneRef.current?.();
      renderInteractiveRef.current?.();
    },
    redraw: () => {
      redrawAllRef.current?.();
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [scene, userId, shapeOwners, themeMode, undo, redo, selectedIds, history, onSceneMutate]);

  // --- drawShape: render a SceneElement using native Canvas 2D ---

  const drawShape = (
    ctx: CanvasRenderingContext2D,
    element: SceneElement,
    themeMode: ThemeMode,
  ) => {
    const strokeColor = getStrokeColor(element.strokeColor, themeMode);

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = element.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (element.strokeStyle === 'dashed') {
      ctx.setLineDash([8, 6]);
    }
    ctx.globalAlpha = element.opacity;

    switch (element.type) {
      case 'rectangle': {
        if (element.fillStyle !== 'none') {
          ctx.fillStyle = element.fillColor;
          if ((element as RectangleElement).borderRadius) {
            const r = (element as RectangleElement).borderRadius!;
            ctx.beginPath();
            ctx.moveTo(element.x + r, element.y);
            ctx.lineTo(element.x + element.width - r, element.y);
            ctx.quadraticCurveTo(element.x + element.width, element.y, element.x + element.width, element.y + r);
            ctx.lineTo(element.x + element.width, element.y + element.height - r);
            ctx.quadraticCurveTo(element.x + element.width, element.y + element.height, element.x + element.width - r, element.y + element.height);
            ctx.lineTo(element.x + r, element.y + element.height);
            ctx.quadraticCurveTo(element.x, element.y + element.height, element.x, element.y + element.height - r);
            ctx.lineTo(element.x, element.y + r);
            ctx.quadraticCurveTo(element.x, element.y, element.x + r, element.y);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(element.x, element.y, element.width, element.height);
          }
        }
        ctx.beginPath();
        ctx.setLineDash(element.strokeStyle === 'dashed' ? [8, 6] : []);
        if ((element as RectangleElement).borderRadius) {
          const r = (element as RectangleElement).borderRadius!;
          ctx.moveTo(element.x + r, element.y);
          ctx.lineTo(element.x + element.width - r, element.y);
          ctx.quadraticCurveTo(element.x + element.width, element.y, element.x + element.width, element.y + r);
          ctx.lineTo(element.x + element.width, element.y + element.height - r);
          ctx.quadraticCurveTo(element.x + element.width, element.y + element.height, element.x + element.width - r, element.y + element.height);
          ctx.lineTo(element.x + r, element.y + element.height);
          ctx.quadraticCurveTo(element.x, element.y + element.height, element.x, element.y + element.height - r);
          ctx.lineTo(element.x, element.y + r);
          ctx.quadraticCurveTo(element.x, element.y, element.x + r, element.y);
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.strokeRect(element.x, element.y, element.width, element.height);
        }
        break;
      }

      case 'ellipse': {
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        const rx = Math.abs(element.width) / 2;
        const ry = Math.abs(element.height) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (element.fillStyle !== 'none') {
          ctx.fillStyle = element.fillColor;
          ctx.fill();
        }
        ctx.setLineDash(element.strokeStyle === 'dashed' ? [8, 6] : []);
        ctx.stroke();
        break;
      }

      case 'rhombus': {
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        const hw = Math.abs(element.width) / 2;
        const hh = Math.abs(element.height) / 2;
        const rhombusBorderRadius = (element as RhombusElement).borderRadius ?? 0;
        ctx.beginPath();
        if (rhombusBorderRadius > 0) {
          // 4-point diamond (rounded corners approximated)
          ctx.moveTo(cx, cy - hh);
          ctx.lineTo(cx + hw, cy);
          ctx.lineTo(cx, cy + hh);
          ctx.lineTo(cx - hw, cy);
          ctx.closePath();
        } else {
          ctx.moveTo(cx, cy - hh);
          ctx.lineTo(cx + hw, cy);
          ctx.lineTo(cx, cy + hh);
          ctx.lineTo(cx - hw, cy);
          ctx.closePath();
        }
        if (element.fillStyle !== 'none') {
          ctx.fillStyle = element.fillColor;
          ctx.fill();
        }
        ctx.setLineDash(element.strokeStyle === 'dashed' ? [8, 6] : []);
        ctx.stroke();
        break;
      }

      case 'freehand': {
        if (element.points.length < 2) break;
        ctx.beginPath();
        ctx.setLineDash([]);
        const pts = element.points;
        ctx.moveTo(pts[0].x + element.x, pts[0].y + element.y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x + element.x, pts[i].y + element.y);
        }
        ctx.stroke();
        break;
      }

      case 'line': {
        if (element.points.length < 2) break;
        ctx.beginPath();
        ctx.setLineDash(element.strokeStyle === 'dashed' ? [8, 6] : []);
        const pts = element.points;
        ctx.moveTo(pts[0].x + element.x, pts[0].y + element.y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x + element.x, pts[i].y + element.y);
        }
        ctx.stroke();
        break;
      }

      case 'arrow': {
        if (element.points.length < 2) break;
        ctx.beginPath();
        ctx.setLineDash(element.strokeStyle === 'dashed' ? [8, 6] : []);
        const pts = element.points;
        ctx.moveTo(pts[0].x + element.x, pts[0].y + element.y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x + element.x, pts[i].y + element.y);
        }
        ctx.stroke();

        // Draw arrowhead(s) using native Canvas 2D
        const drawArrowhead = (
          tipPt: Point,
          refPt: Point,
          headType: Arrowhead,
        ) => {
          const angle = Math.atan2(
            tipPt.y - refPt.y,
            tipPt.x - refPt.x,
          );
          const headSize = element.strokeWidth * 3;
          ctx.save();
          ctx.setLineDash([]);
          ctx.fillStyle = strokeColor;
          ctx.strokeStyle = strokeColor;
          ctx.translate(tipPt.x + element.x, tipPt.y + element.y);
          ctx.rotate(angle);

          switch (headType) {
            case 'arrow': {
              // Triangle pointing forward
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(-headSize, -headSize / 2);
              ctx.lineTo(-headSize, headSize / 2);
              ctx.closePath();
              ctx.fill();
              break;
            }
            case 'bar': {
              // Perpendicular bar across the endpoint
              ctx.lineWidth = element.strokeWidth;
              ctx.beginPath();
              ctx.moveTo(0, -headSize / 2);
              ctx.lineTo(0, headSize / 2);
              ctx.stroke();
              break;
            }
            case 'dot': {
              // Filled circle at the endpoint
              ctx.beginPath();
              ctx.arc(0, 0, headSize / 2, 0, Math.PI * 2);
              ctx.fill();
              break;
            }
            case 'inverted_triangle': {
              // Triangle pointing backward (away from direction)
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(headSize, -headSize / 2);
              ctx.lineTo(headSize, headSize / 2);
              ctx.closePath();
              ctx.fill();
              break;
            }
          }

          ctx.restore();
        };

        // End arrowhead
        if (element.endArrowhead) {
          drawArrowhead(
            pts[pts.length - 1],
            pts[pts.length - 2],
            element.endArrowhead,
          );
        }
        // Start arrowhead
        if (element.startArrowhead && pts.length >= 2) {
          drawArrowhead(pts[0], pts[1], element.startArrowhead);
        }
        break;
      }

      case 'text': {
        if (!element.content) break;
        ctx.restore(); // restore transform state before text rendering
        ctx.save();
        ctx.font = `${element.fontSize}px ${element.fontFamily}`;
        ctx.fillStyle = strokeColor;
        ctx.textBaseline = 'top';
        ctx.globalAlpha = element.opacity;

        let textX = element.x;
        if (element.textAlign === 'center') textX = element.x + element.width / 2;
        else if (element.textAlign === 'right') textX = element.x + element.width;
        ctx.textAlign = element.textAlign;

        const lines = element.content.split('\n');
        const lineHeightPx = element.fontSize * element.lineHeight;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], textX, element.y + i * lineHeightPx);
        }

        // Update element dimensions based on rendered text
        const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
        const totalHeight = lines.length * lineHeightPx;
        if (Math.ceil(maxLineWidth) !== element.width || Math.ceil(totalHeight) !== element.height) {
          element.width = Math.ceil(maxLineWidth);
          element.height = Math.ceil(totalHeight);
        }
        ctx.restore();
        return; // already restored
      }

      case 'image': {
        if (!element.src) break;
        ctx.restore(); // restore transform state before image rendering
        ctx.save();
        let img = imageCacheRef.current.get(element.src);
        if (!img) {
          img = new Image();
          img.src = element.src;
          imageCacheRef.current.set(element.src, img);
        }
        if (img.complete && img.naturalWidth > 0) {
          ctx.globalAlpha = element.opacity;
          ctx.drawImage(img, element.x, element.y, element.width, element.height);
        }
        ctx.restore();
        return; // already restored
      }
    }

    ctx.restore();
  };

  // --- Three-layer canvas rendering ---

  // Layer 0: Background
  const renderBackground = useCallback(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [theme]);

  // Layer 1: Static — renders committed elements using native Canvas 2D
  const renderStaticScene = useCallback(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    applyCanvasTransform(ctx);

    const elements = scene.getElements();
    for (const el of elements) {
      drawShape(ctx, el, themeMode);
    }

    // 防御：绝不为空白文本绘制协作边框
    // Draw colored borders on remote elements (attribution)
    for (const el of elements) {
      if (el.type === 'text' && !(el as any).content) continue;
      const ownerId = shapeOwners.get(el.id);
      if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
        const bounds = getElementBounds(el);
        const borderColor = ownerId.split('-')[0] ?? '#8b5cf6';
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
        ctx.restore();
      }
    }

    ctx.restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, applyCanvasTransform, shapeOwners, userId, scale, themeMode]);

  // Layer 2: Interactive — renders draft elements, selection, resize handles, remote cursors
  const renderInteractive = useCallback(() => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    applyCanvasTransform(ctx);

    // Draw draft element if drawing
    if (interactionMode === 'drawing' && draftRef.current) {
      const draftEl = draftRef.current.element;
      drawShape(ctx, draftEl, themeMode);
    }

    // Eraser: draw red dashed highlight borders around hit elements
    if (interactionMode === 'drawing' && activeTool === 'eraser' && eraserHandlerRef.current) {
      const hitIds = eraserHandlerRef.current.getHitElementIds();
      if (hitIds.size > 0) {
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2 / scaleRef.current;
        ctx.setLineDash([8 / scaleRef.current, 6 / scaleRef.current]);
        for (const el of scene.getElements()) {
          if (!el.isDeleted && hitIds.has(el.id)) {
            const b = getElementBounds(el);
            ctx.strokeRect(b.x, b.y, b.width, b.height);
          }
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Eraser ring: draw on canvas in screen coordinates (fixed size regardless of zoom)
    if (activeTool === 'eraser') {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const screenX = mousePos.current.x * scaleRef.current + panXRef.current;
      const screenY = mousePos.current.y * scaleRef.current + panYRef.current;
      const ringRadius = eraserRadius * scaleRef.current;
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fill();
      ctx.restore();
    }

    // Marquee selection: draw semi-transparent blue rectangle
    if (interactionMode === 'selecting' && marqueeStart.current && marqueeEnd.current) {
      const mx = Math.min(marqueeStart.current.x, marqueeEnd.current.x);
      const my = Math.min(marqueeStart.current.y, marqueeEnd.current.y);
      const mw = Math.abs(marqueeEnd.current.x - marqueeStart.current.x);
      const mh = Math.abs(marqueeEnd.current.y - marqueeStart.current.y);
      ctx.save();
      ctx.fillStyle = 'rgba(0, 120, 255, 0.1)';
      ctx.strokeStyle = '#0078ff';
      ctx.lineWidth = 1.5 / scaleRef.current;
      ctx.setLineDash([6 / scaleRef.current, 4 / scaleRef.current]);
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw selection bounding boxes and resize handles
    const elements = scene.getElements();
    const selectedGroupIds = getSelectedGroupIds();
    const isGroupSelection = selectedGroupIds.length > 0;

    if (isGroupSelection) {
      // Draw a single dashed border around the union bounding box of the group
      const groupId = selectedGroupIds[0];
      const groupBBox = getGroupBBox(groupId);
      if (groupBBox) {
        const bbox = getBBox(groupBBox as unknown as SceneElement);
        if (bbox) {
          ctx.save();
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1.5 / scale;
          ctx.setLineDash([5 / scale, 3 / scale]);
          ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    } else {
      // Draw individual selection borders and resize handles for non-group selections
      for (const selId of selectedIds) {
        const el = elements.find((e) => e.id === selId);
        if (!el) continue;
        const bbox = getBBox(el);
        if (!bbox) continue;

        const ownerId = shapeOwners.get(el.id);
        const isRemote = ownerId && ownerId !== userId;
        ctx.strokeStyle = isRemote && ownerId !== '__remote__' ? (ownerId.split('-')[0] ?? '#3b82f6') : '#3b82f6';
        ctx.lineWidth = 1.5 / scale;
        ctx.setLineDash([5 / scale, 3 / scale]);
        ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
        ctx.setLineDash([]);

        const handles = getHandlePositions(bbox);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = isRemote && ownerId !== '__remote__' ? (ownerId.split('-')[0] ?? '#3b82f6') : '#3b82f6';
        ctx.lineWidth = 1.5 / scale;

        for (const pos of Object.values(handles)) {
          const hs = HANDLE_SIZE / scale;
          ctx.fillRect(pos.x, pos.y, hs, hs);
          ctx.strokeRect(pos.x, pos.y, hs, hs);
        }
      }
    }

    ctx.restore();
  }, [interactionMode, activeTool, selectedIds, scene, getBBox, getHandlePositions, getSelectedGroupIds, getGroupBBox, shapeOwners, userId, scale, themeMode, applyCanvasTransform, drawShape, eraserRadius]);

  // Master redraw
  const redrawCanvas = useCallback(() => {
    renderStaticScene();
    renderInteractive();
  }, [renderStaticScene, renderInteractive]);

  const redrawAll = useCallback(() => {
    renderBackground();
    renderStaticScene();
    renderInteractive();
  }, [renderBackground, renderStaticScene, renderInteractive]);

  // Sync render refs for use in useImperativeHandle
  useEffect(() => {
    redrawAllRef.current = redrawAll;
    renderStaticSceneRef.current = renderStaticScene;
    renderInteractiveRef.current = renderInteractive;
  }, [redrawAll, renderStaticScene, renderInteractive]);

  // --- ToolHandler integration ---

  const setDraft = useCallback((draft: DraftElement | null) => {
    draftRef.current = draft;
    renderInteractive();
  }, [renderInteractive]);

  const createDrawingHandler = useCallback((): ToolHandlerType => {
    const isRoundCapable = activeTool === 'rectangle' || activeTool === 'rectangle-solid' || activeTool === 'rhombus' || activeTool === 'rhombus-solid';
    const style = {
      strokeColor: defaultStyle.strokeColor,
      strokeWidth: defaultStyle.strokeWidth,
      strokeStyle: defaultStyle.strokeStyle,
      fillStyle: defaultStyle.fillStyle,
      fillColor: defaultStyle.fillColor,
      borderRadius: isRoundCapable && isRoundCornerEnabled ? 12 : 0,
    };
    const baseTool = getBaseShapeTool(activeTool);
    switch (baseTool) {
      case 'rectangle':
        return createBBoxHandler('rectangle', style);
      case 'ellipse':
        return createBBoxHandler('ellipse', style);
      case 'rhombus':
        return createBBoxHandler('rhombus', style);
      case 'line':
        return createLineHandler('line', style);
      case 'arrow':
        return createLineHandler('arrow', style, { endArrowhead: 'arrow' });
      case 'freehand':
        return createFreehandHandler(style);
      default:
        // Eraser and select are handled separately in pointer handlers
        return createFreehandHandler(style);
    }
  }, [activeTool, defaultStyle, isRoundCornerEnabled]);

  /**
   * Commit a SceneElement to the scene. Adds to scene, pushes history, triggers redraw.
   */
  const commitElement = useCallback((el: SceneElement) => {
    history.push();
    scene.addElement(el);
    onSceneMutate('add');
    onSelectedIdsChange([el.id]);
    renderStaticScene();
    renderInteractive();
  }, [scene, history, onSceneMutate, onSelectedIdsChange, renderStaticScene, renderInteractive]);

  // --- Canvas setup ---

  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    const staticCanvas = staticCanvasRef.current;
    const interactiveCanvas = interactiveCanvasRef.current;
    if (!bgCanvas || !staticCanvas || !interactiveCanvas) return;

    const resizeCanvases = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      bgCanvas.width = w;
      bgCanvas.height = h;
      staticCanvas.width = w;
      staticCanvas.height = h;
      interactiveCanvas.width = w;
      interactiveCanvas.height = h;
      redrawAll();
    };

    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
    return () => window.removeEventListener('resize', resizeCanvases);
  }, [redrawAll]);

  // Redraw when scene changes (e.g., from remote updates or undo/redo)
  useEffect(() => {
    renderStaticScene();
    renderInteractive();
  }, [scene, selectedIds, scale, renderStaticScene, renderInteractive]);

  // --- Keyboard handlers ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        if (locked) return;
        e.preventDefault();
        undo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        if (locked) return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        history.push();
        for (const id of selectedIds) {
          scene.deleteElement(id);
        }
        onSceneMutate('delete');
        onSelectedIdsChange([]);
        renderStaticScene();
      }

      if (e.key === 'Escape') {
        onSelectedIdsChange([]);
      }

      // Ctrl+G / Cmd+G: Group selected elements
      if (e.key === 'g' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (locked) return;
        if (selectedIds.length >= 2) {
          e.preventDefault();
          history.push();
          scene.groupElements(selectedIds);
          onSceneMutate('update');
          renderStaticScene();
          renderInteractive();
        }
      }

      // Ctrl+Shift+G / Cmd+Shift+G: Ungroup selected elements
      if (e.key === 'G' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (locked) return;
        if (selectedIds.length > 0) {
          const elements = scene.getElements();
          const firstEl = elements.find((el) => el.id === selectedIds[0]);
          if (firstEl && firstEl.groupIds.length > 0) {
            const sharedGroupId = firstEl.groupIds.find((gid) =>
              selectedIds.every((id) => {
                const el = elements.find((e) => e.id === id);
                return el && el.groupIds.includes(gid);
              }),
            );
            if (sharedGroupId) {
              e.preventDefault();
              history.push();
              scene.ungroupElements(selectedIds, sharedGroupId);
              onSceneMutate('update');
              renderStaticScene();
              renderInteractive();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, scene, history, undo, onSceneMutate, onSelectedIdsChange, locked, renderStaticScene]);

  // Track space key state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        spacePressed.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spacePressed.current = false;
        if (interactionMode === 'panning') {
          setInteractionMode('idle');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [interactionMode]);

  // Focus text input when editing starts
  useEffect(() => {
    if (editingText && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [editingText]);

  // Keyboard handling for text editing
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!editingText) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishEditing();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingText]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // --- Wheel handler for zoom ---

  const commitZoomToState = useCallback(() => {
    onScaleChange(scaleRef.current);
    onPanXChange(panXRef.current);
    onPanYChange(panYRef.current);
  }, [onScaleChange, onPanXChange, onPanYChange]);

  useEffect(() => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const currentScale = scaleRef.current;
      const currentPanX = panXRef.current;
      const currentPanY = panYRef.current;
      const direction = Math.sign(e.deltaY);
      const newScale = direction > 0 ? currentScale - ZOOM_STEP : currentScale + ZOOM_STEP;
      const clampedScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newScale));

      // Viewport-center-based zoom using shared utility
      const newTransform = zoomFromCenter(
        { scrollX: currentPanX, scrollY: currentPanY, zoom: currentScale },
        canvas.width,
        canvas.height,
        clampedScale,
      );

      scaleRef.current = newTransform.zoom;
      panXRef.current = newTransform.scrollX;
      panYRef.current = newTransform.scrollY;

      // Redraw all layers with ref-based transform
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear and redraw static layer
      const staticCanvas = staticCanvasRef.current;
      if (staticCanvas) {
        const staticCtx = staticCanvas.getContext('2d');
        if (staticCtx) {
          staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
          staticCtx.save();
          applyCanvasTransformFromRefs(staticCtx);
          const elements = scene.getElements();
          for (const el of elements) {
            drawShape(staticCtx, el, themeMode);
          }
          staticCtx.restore();
        }
      }

      // Clear and redraw interactive layer
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      applyCanvasTransformFromRefs(ctx);

      // Selection bounding boxes
      const elements = scene.getElements();

      // Check if selected elements share a groupId
      const hasGroupSelection = selectedIds.length > 0 && selectedIds.some((id) => {
        const el = scene.getElement(id);
        return el && el.groupIds.length > 0;
      });

      if (hasGroupSelection && selectedIds.length > 0) {
        // For group selections, draw a single dashed border around the union bbox
        const groupId = selectedIds[0];
        const el = scene.getElement(groupId);
        if (el && el.groupIds.length > 0) {
          const sharedGroupId = el.groupIds[0];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const otherEl of elements) {
            if (otherEl.groupIds.includes(sharedGroupId)) {
              const b = getElementBounds(otherEl);
              if (b.x < minX) minX = b.x;
              if (b.y < minY) minY = b.y;
              if (b.x + b.width > maxX) maxX = b.x + b.width;
              if (b.y + b.height > maxY) maxY = b.y + b.height;
            }
          }
          if (minX !== Infinity) {
            const paddedBBox = {
              x: minX - BBOX_PADDING,
              y: minY - BBOX_PADDING,
              width: maxX - minX + BBOX_PADDING * 2,
              height: maxY - minY + BBOX_PADDING * 2,
            };
            ctx.save();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1.5 / newScale;
            ctx.setLineDash([5 / newScale, 3 / newScale]);
            ctx.strokeRect(paddedBBox.x, paddedBBox.y, paddedBBox.width, paddedBBox.height);
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
      } else {
        // For non-group selections, draw individual borders and handles
        for (const selId of selectedIds) {
          const el = elements.find((e) => e.id === selId);
          if (!el) continue;
          const bbox = getBBox(el);
          if (!bbox) continue;

          const ownerId = shapeOwners.get(el.id);
          const isRemote = ownerId && ownerId !== userId;
          ctx.strokeStyle = isRemote && ownerId !== '__remote__' ? (ownerId.split('-')[0] ?? '#3b82f6') : '#3b82f6';
          ctx.lineWidth = 1.5 / newScale;
          ctx.setLineDash([5 / newScale, 3 / newScale]);
          ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
          ctx.setLineDash([]);

          const handles = getHandlePositions(bbox);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = isRemote && ownerId !== '__remote__' ? (ownerId.split('-')[0] ?? '#3b82f6') : '#3b82f6';
          ctx.lineWidth = 1.5 / newScale;

          for (const pos of Object.values(handles)) {
            const hs = HANDLE_SIZE / newScale;
            ctx.fillRect(pos.x, pos.y, hs, hs);
            ctx.strokeRect(pos.x, pos.y, hs, hs);
          }
        }
      }

      ctx.restore();

      // Debounce state sync
      if (zoomCommitTimer.current) clearTimeout(zoomCommitTimer.current);
      zoomCommitTimer.current = setTimeout(() => {
        commitZoomToState();
      }, 150);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (zoomCommitTimer.current) clearTimeout(zoomCommitTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, getBBox, getHandlePositions, userId, shapeOwners, applyCanvasTransformFromRefs, commitZoomToState, themeMode, scene]);

  // --- Scene hit detection ---

  const hitTestElements = (point: Point): SceneElement | null => {
    const elements = scene.getElements();
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const bounds = getElementBounds(el);

      if (el.type === 'freehand') {
        if (isPointInFreehand(el, point)) return el;
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
  };

  const isPointInFreehand = (el: { points: Point[] }, point: Point): boolean => {
    const pts = el.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  // --- Resize handle hit detection ---

  const hitTestHandles = (point: Point): 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null => {
    const primaryId = selectedIds[selectedIds.length - 1];
    if (!primaryId) return null;
    const el = scene.getElement(primaryId);
    if (!el) return null;
    const bbox = getBBox(el);
    if (!bbox) return null;
    const handles = getHandlePositions(bbox);
    const scaledHandleSize = HANDLE_SIZE / scale;

    for (const [handle, pos] of Object.entries(handles)) {
      if (
        point.x >= pos.x &&
        point.x <= pos.x + scaledHandleSize &&
        point.y >= pos.y &&
        point.y <= pos.y + scaledHandleSize
      ) {
        return handle as 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
      }
    }
    return null;
  };

  // --- Resize helper (absolute coordinate calculation) ---

  const applyResize = (
    el: SceneElement,
    handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
    mouseX: number,
    mouseY: number,
  ): SceneElement => {
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
      return { ...el, x: el.x + offX, y: el.y + offY };
    }
    return { ...el, x, y, width, height };
  };

  // --- Pointer event coordinate conversion ---

  const getWorldPoint = (e: React.PointerEvent): Point => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - panXRef.current) / scaleRef.current,
      y: (screenY - panYRef.current) / scaleRef.current,
    };
  };

  // --- Text editing ---

  const finishEditing = () => {
    if (!editingText) return;
    const { shapeId, content, isNew } = editingText;
    if (content.trim()) {
      const ctx = interactiveCanvasRef.current?.getContext('2d');
      let width = 100;
      let height = 20;
      if (ctx) {
        ctx.font = `${editingText.fontSize}px sans-serif`;
        const metrics = ctx.measureText(content);
        width = Math.ceil(metrics.width);
        height = editingText.fontSize;
      }
      if (!isNew) {
        history.push();
      }
      scene.updateElement(shapeId, { content: content.trim(), width, height });
      onSceneMutate('update');
      renderStaticScene();
    } else {
      // Remove empty text shapes
      if (!isNew) {
        history.push();
      }
      scene.deleteElement(shapeId);
      onSceneMutate('delete');
      renderStaticScene();
    }
    setEditingText(null);
  };

  const cancelEditing = () => {
    if (!editingText) return;
    if (!editingText.content.trim()) {
      if (!editingText.isNew) {
        history.push();
      }
      scene.deleteElement(editingText.shapeId);
      onSceneMutate('delete');
      renderStaticScene();
    }
    setEditingText(null);
  };

  // --- Unified pointer event pipeline ---

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingText) return;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const world = getWorldPoint(e);

    // When locked, only panning is allowed
    if (locked) {
      if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
        e.preventDefault();
        panStart.current = { x: e.clientX - panXRef.current, y: e.clientY - panYRef.current };
        if (e.button === 1) isMiddleButton.current = true;
        isPanning.current = true;
        setInteractionMode('panning');
      }
      return;
    }

    // Eraser tool
    if (activeTool === 'eraser') {
      e.preventDefault();
      isDrawing.current = true;
      eraserHandlerRef.current = createEraserHandler(() => scene.getElements());
      eraserHandlerRef.current.onPointerDown(world.x, world.y, setDraft);
      setInteractionMode('drawing');
      return;
    }

    // Middle-click or space+drag starts panning
    if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
      e.preventDefault();
      panStart.current = { x: e.clientX - panXRef.current, y: e.clientY - panYRef.current };
      if (e.button === 1) isMiddleButton.current = true;
      isPanning.current = true;
      setInteractionMode('panning');
      return;
    }

    if (activeTool !== 'select') {
      // Drawing mode — delegate to ToolHandler
      isDrawing.current = true;
      activeHandlerRef.current = createDrawingHandler();
      activeHandlerRef.current.onPointerDown(world.x, world.y, setDraft);
      setInteractionMode('drawing');
      return;
    }

    // Select tool: hit-testing, resize handle detection, move/resize mode entry
    // Disable resize handles for group selections — groups can only be moved, not resized
    const hasGroupedElement = selectedIds.some((id) => {
      const el = scene.getElement(id);
      return el && el.groupIds.length > 0;
    });
    const handle = hasGroupedElement ? null : hitTestHandles(world);
    const primaryId = selectedIds[selectedIds.length - 1];
    if (handle && primaryId) {
      const el = scene.getElement(primaryId);
      if (el) {
        const bounds = getElementBounds(el);
        resizeStartBounds.current = { ...bounds };
        setActiveHandle(handle);
        setInteractionMode('resizing');
      }
      return;
    }

    const hitEl = hitTestElements(world);
    if (hitEl) {
      // If the clicked element belongs to a group, select all group members
      const groupIds = scene.getGroupElementIds(hitEl.id);
      if (groupIds.length > 0) {
        onSelectedIdsChange(groupIds);
      } else {
        onSelectedIdsChange([hitEl.id]);
      }
      const bounds = getElementBounds(hitEl);
      moveOffset.current = { x: world.x - bounds.x, y: world.y - bounds.y };
      setInteractionMode('moving');
    } else {
      onSelectedIdsChange([]);
      marqueeStart.current = world;
      marqueeEnd.current = null;
      setInteractionMode('selecting');
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (locked && !isPanning.current) return;

    const point = getWorldPoint(e);
    mousePos.current = point;

    if (interactionMode === 'drawing') {
      // Eraser: track points and check for element hits
      if (activeTool === 'eraser' && eraserHandlerRef.current) {
        eraserHandlerRef.current.onPointerMove(point.x, point.y, null, setDraft);
        redrawCanvas();
        return;
      }

      // Delegate to ToolHandler for drawing tools
      const handler = activeHandlerRef.current;
      if (handler) {
        // Clear interactive canvas before each draft redraw to prevent ghost trails
        const interactiveCanvas = interactiveCanvasRef.current;
        if (interactiveCanvas) {
          const ctx = interactiveCanvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, interactiveCanvas.width, interactiveCanvas.height);
          }
        }
        handler.onPointerMove(point.x, point.y, draftRef.current, setDraft);
      }

      broadcastCursor(point.x, point.y, true);
      return;
    }

    if (interactionMode === 'moving' && selectedIds.length > 0) {
      const elements = scene.getElements();
      const selectedIdSet = new Set(selectedIds);
      const currentElements = moveElementsRef.current ?? elements;

      const primaryEl = currentElements.find((el) => el.id === selectedIds[selectedIds.length - 1]);
      if (!primaryEl) return;

      const bounds = getElementBounds(primaryEl);
      const newX = point.x - moveOffset.current.x;
      const newY = point.y - moveOffset.current.y;
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
        // Move x/y for all other element types
        return { ...el, x: el.x + dx, y: el.y + dy };
      });

      moveElementsRef.current = newElements;
      onMoveElements(newElements);
      renderStaticScene();
      renderInteractive();
      return;
    }

    if (interactionMode === 'resizing' && selectedIds.length > 0 && activeHandle) {
      const primaryId = selectedIds[selectedIds.length - 1];
      const currentElements = moveElementsRef.current ?? scene.getElements();
      const el = currentElements.find((e) => e.id === primaryId);
      if (!el) return;

      const resized = applyResize(el, activeHandle, point.x, point.y);
      const newElements = currentElements.map((e) => (e.id === primaryId ? resized : e));
      moveElementsRef.current = newElements;
      onMoveElements(newElements);
      renderStaticScene();
      renderInteractive();
      return;
    }

    if (interactionMode === 'panning') {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      panXRef.current = dx;
      panYRef.current = dy;

      // Redraw all three layers with ref-based transform
      const bgCanvas = bgCanvasRef.current;
      const staticCanvas = staticCanvasRef.current;
      const interactiveCanvas = interactiveCanvasRef.current;
      if (bgCanvas && staticCanvas && interactiveCanvas) {
        const bgCtx = bgCanvas.getContext('2d');
        const staticCtx = staticCanvas.getContext('2d');
        const interactiveCtx = interactiveCanvas.getContext('2d');
        if (!bgCtx || !staticCtx || !interactiveCtx) return;

        bgCtx.fillStyle = theme.canvasBg;
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
        staticCtx.save();
        applyCanvasTransformFromRefs(staticCtx);
        const elements = scene.getElements();
        for (const el of elements) {
          drawShape(staticCtx, el, themeMode);
        }
        for (const el of elements) {
          const ownerId = shapeOwners.get(el.id);
          if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
            const bounds = getElementBounds(el);
            const borderColor = ownerId.split('-')[0] ?? '#8b5cf6';
            staticCtx.save();
            staticCtx.strokeStyle = borderColor;
            staticCtx.lineWidth = 2 / scaleRef.current;
            staticCtx.setLineDash([]);
            staticCtx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
            staticCtx.restore();
          }
        }
        staticCtx.restore();

        interactiveCtx.clearRect(0, 0, interactiveCanvas.width, interactiveCanvas.height);
        interactiveCtx.save();
        applyCanvasTransformFromRefs(interactiveCtx);

        // Check for group selection
        const hasGroupSel = selectedIds.some((id) => {
          const el = scene.getElement(id);
          return el && el.groupIds.length > 0;
        });

        if (hasGroupSel && selectedIds.length > 0) {
          const firstEl = scene.getElement(selectedIds[0]);
          if (firstEl && firstEl.groupIds.length > 0) {
            const gid = firstEl.groupIds[0];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const otherEl of elements) {
              if (otherEl.groupIds.includes(gid)) {
                const b = getElementBounds(otherEl);
                if (b.x < minX) minX = b.x;
                if (b.y < minY) minY = b.y;
                if (b.x + b.width > maxX) maxX = b.x + b.width;
                if (b.y + b.height > maxY) maxY = b.y + b.height;
              }
            }
            if (minX !== Infinity) {
              const paddedBBox = {
                x: minX - BBOX_PADDING,
                y: minY - BBOX_PADDING,
                width: maxX - minX + BBOX_PADDING * 2,
                height: maxY - minY + BBOX_PADDING * 2,
              };
              interactiveCtx.save();
              interactiveCtx.strokeStyle = '#3b82f6';
              interactiveCtx.lineWidth = 1.5 / scaleRef.current;
              interactiveCtx.setLineDash([5 / scaleRef.current, 3 / scaleRef.current]);
              interactiveCtx.strokeRect(paddedBBox.x, paddedBBox.y, paddedBBox.width, paddedBBox.height);
              interactiveCtx.setLineDash([]);
              interactiveCtx.restore();
            }
          }
        } else {
          for (const selId of selectedIds) {
            const el = elements.find((e) => e.id === selId);
            if (!el) continue;
            const bbox = getBBox(el);
            if (!bbox) continue;
            const ownerId = shapeOwners.get(el.id);
            const isRemote = ownerId && ownerId !== userId;
            interactiveCtx.strokeStyle = isRemote && ownerId !== '__remote__' ? (ownerId.split('-')[0] ?? '#3b82f6') : '#3b82f6';
            interactiveCtx.lineWidth = 1.5 / scaleRef.current;
            interactiveCtx.setLineDash([5 / scaleRef.current, 3 / scaleRef.current]);
            interactiveCtx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
            interactiveCtx.setLineDash([]);
            const handles = getHandlePositions(bbox);
            interactiveCtx.fillStyle = '#ffffff';
            interactiveCtx.strokeStyle = isRemote && ownerId !== '__remote__' ? (ownerId.split('-')[0] ?? '#3b82f6') : '#3b82f6';
            interactiveCtx.lineWidth = 1.5 / scaleRef.current;
            for (const pos of Object.values(handles)) {
              const hs = HANDLE_SIZE / scaleRef.current;
              interactiveCtx.fillRect(pos.x, pos.y, hs, hs);
              interactiveCtx.strokeRect(pos.x, pos.y, hs, hs);
            }
          }
        }
        interactiveCtx.restore();
      }
      return;
    }

    // Marquee selection: draw rectangle and highlight intersecting elements
    if (interactionMode === 'selecting' && marqueeStart.current) {
      marqueeEnd.current = point;
      renderInteractive();
      return;
    }

    // Update cursor style based on hover (skip resize cursors for group selections)
    if (activeTool === 'select' && selectedIds.length > 0) {
      const hasGrouped = selectedIds.some((id) => {
        const el = scene.getElement(id);
        return el && el.groupIds.length > 0;
      });
      if (!hasGrouped) {
        const handle = hitTestHandles(point);
        if (handle) {
          const cursorMap: Record<string, string> = {
            nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
            n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
          };
          interactiveCanvasRef.current!.style.cursor = cursorMap[handle];
          return;
        }
      }
    }

    // Eraser ring: draw on interactive canvas during idle pointer move
    if (interactionMode === 'idle' && activeTool === 'eraser') {
      const canvas = interactiveCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          applyCanvasTransform(ctx);
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const screenX = point.x * scaleRef.current + panXRef.current;
          const screenY = point.y * scaleRef.current + panYRef.current;
          const ringRadius = eraserRadius * scaleRef.current;
          ctx.beginPath();
          ctx.arc(screenX, screenY, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fill();
          ctx.restore();
          ctx.restore();
        }
      }
      return;
    }

    broadcastCursor(point.x, point.y, false);
  };

  const onPointerLeave = () => {
    if (interactionMode === 'panning') return;
    // Clear eraser ring when mouse leaves canvas
    if (activeTool === 'eraser') {
      const canvas = interactiveCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
    broadcastCursor(mousePos.current.x, mousePos.current.y, false);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const target = e.currentTarget;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }

    if (interactionMode === 'drawing') {
      isDrawing.current = false;

      // Eraser: delete all hit elements in one batch
      if (activeTool === 'eraser' && eraserHandlerRef.current) {
        const hitIds = eraserHandlerRef.current.finish();
        if (hitIds.size > 0) {
          history.push();
          for (const id of hitIds) {
            const el = scene.getElement(id);
            if (el && !el.isDeleted) {
              scene.updateElement(id, { isDeleted: true });
            }
          }
          onSceneMutate('delete');
          redrawCanvas();
        }
        eraserHandlerRef.current = null;
        setInteractionMode('idle');
        return;
      }

      // Delegate to ToolHandler for drawing tools
      const handler = activeHandlerRef.current;
      if (handler) {
        const result = handler.onPointerUp(draftRef.current, commitElement);
        if (!result) {
          redrawCanvas();
        }
      }

      // Clear interactive canvas to remove draft shape after committing
      const interactiveCanvas = interactiveCanvasRef.current;
      if (interactiveCanvas) {
        const ctx = interactiveCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, interactiveCanvas.width, interactiveCanvas.height);
        }
      }

      draftRef.current = null;
      activeHandlerRef.current = null;
      setInteractionMode('idle');
      return;
    }

    if (interactionMode === 'moving' || interactionMode === 'resizing') {
      // Commit intermediate elements to the scene
      const finalElements = moveElementsRef.current;
      if (finalElements && finalElements.length > 0) {
        history.push();
        for (const el of finalElements) {
          scene.updateElement(el.id, el as Partial<SceneElement>);
        }
        onSceneMutate('update');
      }
      moveElementsRef.current = null;
      setInteractionMode('idle');
      setActiveHandle(null);
      renderStaticScene();
      return;
    }

    if (interactionMode === 'panning') {
      onPanXChange(panXRef.current);
      onPanYChange(panYRef.current);
      isMiddleButton.current = false;
      isPanning.current = false;
      setInteractionMode('idle');
      return;
    }

    if (interactionMode === 'selecting') {
      const start = marqueeStart.current;
      const end = marqueeEnd.current;
      if (start && end) {
        const mx = Math.min(start.x, end.x);
        const my = Math.min(start.y, end.y);
        const mw = Math.abs(end.x - start.x);
        const mh = Math.abs(end.y - start.y);
        // Only select if marquee is large enough (not a click)
        if (mw > 3 || mh > 3) {
          const elements = scene.getElements();
          const ids = findElementsInRect({ x: mx, y: my, width: mw, height: mh }, elements);
          onSelectedIdsChange(ids);
        }
      }
      marqueeStart.current = null;
      marqueeEnd.current = null;
      renderInteractive();
      setInteractionMode('idle');
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (editingText) return;
    if (locked) return;

    const point = getWorldPoint(e as unknown as React.PointerEvent);
    const hitEl = hitTestElements(point);

    if (!hitEl) {
      // Double-click on empty canvas opens inline text editor
      const id = generateId();
      const newEl: SceneElement = {
        id,
        type: 'text',
        x: point.x,
        y: point.y,
        width: 0,
        height: 20,
        angle: 0,
        strokeColor: defaultStyle.strokeColor,
        strokeWidth: defaultStyle.strokeWidth,
        strokeStyle: defaultStyle.strokeStyle,
        fillStyle: defaultStyle.fillStyle,
        fillColor: defaultStyle.fillColor,
        opacity: 1,
        version: 1,
        versionNonce: Math.floor(Math.random() * 1e9),
        isDeleted: false,
        groupIds: [],
        index: Date.now(),
        updated: Date.now(),
        ownerId: userId ?? '',
        content: '',
        fontSize: 20,
        fontFamily: 'sans-serif',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.25,
      };
      history.push();
      scene.addElement(newEl);
      onSceneMutate('add');
      setEditingText({ shapeId: id, x: point.x, y: point.y, content: '', fontSize: 20, isNew: true });
    } else if (hitEl.type === 'text') {
      const textEl = hitEl as Extract<SceneElement, { type: 'text' }>;
      setEditingText({
        shapeId: textEl.id,
        x: textEl.x,
        y: textEl.y,
        content: textEl.content,
        fontSize: textEl.fontSize,
        isNew: false,
      });
    }
  };

  const cursorStyle = locked
    ? 'not-allowed'
    : interactionMode === 'moving'
      ? 'move'
      : interactionMode === 'panning'
        ? 'grabbing'
        : interactionMode === 'resizing'
          ? 'crosshair'
          : activeTool === 'eraser'
            ? 'none'
            : activeTool === 'select' && spacePressed.current
              ? 'grab'
              : activeTool === 'select'
                ? 'default'
                : 'crosshair';

  return (
    <>
      {/* Three-layer canvas container */}
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}>
        {/* Layer 0: Background */}
        <canvas
          ref={bgCanvasRef}
          id="canvas-bg"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
        {/* Layer 1: Static (native Canvas 2D committed elements) */}
        <canvas
          ref={staticCanvasRef}
          id="canvas-static"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
        {/* Layer 2: Interactive (draft, selection, remote cursors) */}
        <canvas
          ref={interactiveCanvasRef}
          id="canvas-interactive"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            cursor: cursorStyle,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDoubleClick={handleDoubleClick}
        />
      </div>
      {Array.from(remoteCursors.values()).map((cursor) => {
        const colorName = HEX_TO_COLOR_NAME[cursor.color] ?? '';
        const displayName = colorName ? `${colorName} ${cursor.name}` : cursor.name;
        const screenX = cursor.x * scale + panX;
        const screenY = cursor.y * scale + panY;
        return (
          <div
            key={cursor.userId}
            style={{
              position: 'fixed',
              left: screenX,
              top: screenY,
              pointerEvents: 'none',
              zIndex: 1000,
            }}
          >
            <svg width="24" height="28" viewBox="0 0 24 28" style={{ display: 'block' }}>
              <path
                d="M2 2 L2 18 L6.5 13.5 L10.5 20 L13 18.5 L9 12.5 L15 12.5 Z"
                fill={cursor.color}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              {cursor.isDrawing && (
                <g transform="translate(16, 16)">
                  <rect x="-4" y="-4" width="8" height="8" rx="1" fill="#fbbf24" stroke="#92400e" strokeWidth="0.8" />
                  <line x1="-2" y1="-2" x2="2" y2="2" stroke="#92400e" strokeWidth="0.6" />
                </g>
              )}
            </svg>
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 8,
                backgroundColor: cursor.color,
                color: '#ffffff',
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 11,
                fontFamily: 'sans-serif',
                whiteSpace: 'nowrap',
                lineHeight: '16px',
              }}
            >
              {displayName}
            </div>
          </div>
        );
      })}
      {editingText && (
        <textarea
          ref={textInputRef}
          value={editingText.content}
          onChange={(e) =>
            setEditingText((prev) => (prev ? { ...prev, content: e.target.value } : prev))
          }
          onBlur={finishEditing}
          style={{
            position: 'fixed',
            left: editingText.x * scale + panX,
            top: editingText.y * scale + panY,
            minWidth: '100px',
            border: `2px solid ${theme.textEditorBorder}`,
            outline: 'none',
            backgroundColor: theme.textEditorBg,
            fontFamily: 'sans-serif',
            fontSize: `${editingText.fontSize}px`,
            color: theme.textPrimary,
            padding: '2px 4px',
            resize: 'none',
            overflow: 'hidden',
            zIndex: 100,
          }}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              finishEditing();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelEditing();
            }
          }}
        />
      )}
    </>
  );
});

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
