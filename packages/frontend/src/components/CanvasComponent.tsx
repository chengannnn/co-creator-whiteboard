import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { RoughCanvas } from 'roughjs/bin/canvas.js';
import { Scene } from '../core/Scene';
import { HistoryManager } from '../core/HistoryManager';
import type { SceneElement, DraftElement, StrokeWidth, ToolHandler as ToolHandlerType, Point, RectangleElement, RhombusElement } from '../types/element';
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
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
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
  const ZOOM_FACTOR = 0.08;

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

      const rc = new RoughCanvas(offscreen);

      // Background matching current theme
      ctx.fillStyle = theme.canvasBg;
      ctx.fillRect(0, 0, exportWidth, exportHeight);

      // Apply transform: shift content so minX-padding maps to 0
      ctx.setTransform(1, 0, 0, 1, -minX + padding, -minY + padding);

      // Render all elements
      for (const el of elements) {
        drawShape(rc, el, themeMode);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [scene, userId, shapeOwners, themeMode, undo, redo]);

  // --- drawShape: render a SceneElement using roughjs ---

  const drawShape = (
    rc: RoughCanvas,
    element: SceneElement,
    themeMode: ThemeMode,
  ) => {
    const strokeColor = getStrokeColor(element.strokeColor, themeMode);
    const opts: {
      stroke: string;
      strokeWidth: StrokeWidth;
      strokeLineDash?: number[];
      fill?: string;
      fillStyle?: 'cross-hatch' | 'solid';
      hachureAngle: number;
      hachureGap: number;
      roughness: number;
    } = {
      stroke: strokeColor,
      strokeWidth: element.strokeWidth,
      strokeLineDash: element.strokeStyle === 'dashed' ? [8, 6] : undefined,
      fill: element.fillStyle === 'none' ? undefined : element.fillColor,
      fillStyle: element.fillStyle === 'hatch' ? 'cross-hatch' : element.fillStyle === 'solid' ? 'solid' : undefined,
      hachureAngle: 60,
      hachureGap: element.strokeWidth * 4,
      roughness: element.roughness,
    };

    switch (element.type) {
      case 'rectangle': {
        /* eslint-disable @typescript-eslint/no-explicit-any -- rough.js supports borderRadius as an undocumented option */
        const rectOpts = { ...opts, borderRadius: (element as RectangleElement).borderRadius ?? 0 };
        rc.rectangle(element.x, element.y, element.width, element.height, rectOpts as any);
        /* eslint-enable @typescript-eslint/no-explicit-any */
        break;
      }

      case 'ellipse':
        rc.ellipse(
          element.x + element.width / 2,
          element.y + element.height / 2,
          Math.abs(element.width),
          Math.abs(element.height),
          opts,
        );
        break;

      case 'rhombus': {
        const cx = element.x + element.width / 2;
        const cy = element.y + element.height / 2;
        const hw = Math.abs(element.width) / 2;
        const hh = Math.abs(element.height) / 2;
        const rhombusBorderRadius = (element as RhombusElement).borderRadius ?? 0;
        if (rhombusBorderRadius > 0) {
          // Draw a rounded rectangle rotated by 45 degrees to create a rounded rhombus
          const side = Math.min(hw, hh) * Math.sqrt(2);
          /* eslint-disable @typescript-eslint/no-explicit-any -- rough.js supports borderRadius and rotation as undocumented options */
          rc.rectangle(cx - side, cy - side, side * 2, side * 2, {
            ...opts,
            borderRadius: rhombusBorderRadius,
            rotation: Math.PI / 4,
            roughness: opts.roughness,
          } as any);
          /* eslint-enable @typescript-eslint/no-explicit-any */
        } else {
          rc.polygon(
            [
              [cx, cy - hh],
              [cx + hw, cy],
              [cx, cy + hh],
              [cx - hw, cy],
            ],
            opts,
          );
        }
        break;
      }

      case 'freehand': {
        if (element.points.length < 2) break;
        rc.linearPath(element.points.map((p) => [p.x + element.x, p.y + element.y]), {
          stroke: opts.stroke,
          strokeWidth: opts.strokeWidth,
          strokeLineDash: opts.strokeLineDash,
          roughness: 0.5,
        });
        break;
      }

      case 'line': {
        if (element.points.length < 2) break;
        rc.linearPath(element.points.map((p) => [p.x + element.x, p.y + element.y]), {
          stroke: opts.stroke,
          strokeWidth: opts.strokeWidth,
          strokeLineDash: opts.strokeLineDash,
          roughness: opts.roughness,
        });
        break;
      }

      case 'arrow': {
        if (element.points.length < 2) break;
        rc.linearPath(element.points.map((p) => [p.x + element.x, p.y + element.y]), {
          stroke: opts.stroke,
          strokeWidth: opts.strokeWidth,
          strokeLineDash: opts.strokeLineDash,
          roughness: opts.roughness,
        });
        // Draw arrowhead(s) using raw canvas 2D
        const ctx = staticCanvasRef.current?.getContext('2d');
        if (!ctx) break;
        const pts = element.points;
        // End arrowhead
        if (element.endArrowhead === 'arrow') {
          const last = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
          const headSize = element.strokeWidth * 3;
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.translate(last.x + element.x, last.y + element.y);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-headSize, -headSize / 2);
          ctx.lineTo(-headSize, headSize / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        // Start arrowhead
        if (element.startArrowhead === 'arrow' && pts.length >= 2) {
          const first = pts[0];
          const next = pts[1];
          const angle = Math.atan2(first.y - next.y, first.x - next.x);
          const headSize = element.strokeWidth * 3;
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.translate(first.x + element.x, first.y + element.y);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-headSize, -headSize / 2);
          ctx.lineTo(-headSize, headSize / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        break;
      }

      case 'text': {
        if (!element.content) break;
        const ctx = staticCanvasRef.current?.getContext('2d');
        if (!ctx) break;
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
        break;
      }

      case 'image': {
        if (!element.src) break;
        const ctx = staticCanvasRef.current?.getContext('2d');
        if (!ctx) break;
        let img = imageCacheRef.current.get(element.src);
        if (!img) {
          img = new Image();
          img.src = element.src;
          imageCacheRef.current.set(element.src, img);
        }
        if (img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = element.opacity;
          ctx.drawImage(img, element.x, element.y, element.width, element.height);
          ctx.restore();
        }
        break;
      }
    }
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

  // Layer 1: Static — renders committed elements using roughjs
  const renderStaticScene = useCallback(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rc = roughCanvasRef.current;
    if (!ctx || !rc) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    applyCanvasTransform(ctx);

    const elements = scene.getElements();
    for (const el of elements) {
      drawShape(rc, el, themeMode);
    }

    // Draw colored borders on remote elements (attribution)
    for (const el of elements) {
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
      const rc = roughCanvasRef.current;
      if (rc) {
        const draftEl = draftRef.current.element;
        drawShape(rc, draftEl, themeMode);
      }
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

    // Draw selection bounding boxes and resize handles
    const elements = scene.getElements();
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

    ctx.restore();
  }, [interactionMode, activeTool, selectedIds, scene, getBBox, getHandlePositions, shapeOwners, userId, scale, themeMode, applyCanvasTransform, drawShape]);

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
    scene.addElement(el);
    history.push();
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
      roughCanvasRef.current = new RoughCanvas(staticCanvas);
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
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const currentScale = scaleRef.current;
      const currentPanX = panXRef.current;
      const currentPanY = panYRef.current;
      const delta = -e.deltaY * ZOOM_FACTOR;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentScale + delta));

      const scaleRatio = newScale / currentScale;
      const newPanX = mouseX - (mouseX - currentPanX) * scaleRatio;
      const newPanY = mouseY - (mouseY - currentPanY) * scaleRatio;

      scaleRef.current = newScale;
      panXRef.current = newPanX;
      panYRef.current = newPanY;

      // Redraw all layers with ref-based transform
      const roughCanvas = roughCanvasRef.current;
      if (!roughCanvas) return;
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
            drawShape(roughCanvas, el, themeMode);
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

  // --- Resize helper ---

  const applyResize = (
    el: SceneElement,
    handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
    dx: number,
    dy: number,
  ): SceneElement => {
    const bounds = getElementBounds(el);
    let { x, y, width, height } = bounds;

    switch (handle) {
      case 'se': width += dx; height += dy; break;
      case 'sw': x += dx; width -= dx; height += dy; break;
      case 'ne': width += dx; y += dy; height -= dy; break;
      case 'nw': x += dx; y += dy; width -= dx; height -= dy; break;
      case 'n': y += dy; height -= dy; break;
      case 's': height += dy; break;
      case 'e': width += dx; break;
      case 'w': x += dx; width -= dx; break;
    }

    if (width < 10) { x -= 10 - width; width = 10; }
    if (height < 10) { y -= 10 - height; height = 10; }

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
    const { shapeId, content } = editingText;
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
      history.push();
      scene.updateElement(shapeId, { content: content.trim(), width, height });
      onSceneMutate('update');
      renderStaticScene();
    } else {
      // Remove empty text shapes
      history.push();
      scene.deleteElement(shapeId);
      onSceneMutate('delete');
      renderStaticScene();
    }
    setEditingText(null);
  };

  const cancelEditing = () => {
    if (!editingText) return;
    if (!editingText.content.trim()) {
      history.push();
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
    const handle = hitTestHandles(world);
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
      onSelectedIdsChange([hitEl.id]);
      const bounds = getElementBounds(hitEl);
      moveOffset.current = { x: world.x - bounds.x, y: world.y - bounds.y };
      setInteractionMode('moving');
    } else {
      onSelectedIdsChange([]);
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
      return;
    }

    if (interactionMode === 'resizing' && selectedIds.length > 0 && activeHandle) {
      const primaryId = selectedIds[selectedIds.length - 1];
      const currentElements = moveElementsRef.current ?? scene.getElements();
      const el = currentElements.find((e) => e.id === primaryId);
      if (!el) return;

      const orig = resizeStartBounds.current;
      const dx = point.x - (orig.x + (activeHandle.includes('e') ? orig.width : 0));
      const dy = point.y - (orig.y + (activeHandle.includes('s') ? orig.height : 0));

      const resized = applyResize(el, activeHandle, dx, dy);
      const newElements = currentElements.map((e) => (e.id === primaryId ? resized : e));
      moveElementsRef.current = newElements;
      onMoveElements(newElements);
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
        const rc = roughCanvasRef.current;
        if (!bgCtx || !staticCtx || !interactiveCtx || !rc) return;

        bgCtx.fillStyle = theme.canvasBg;
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
        staticCtx.save();
        applyCanvasTransformFromRefs(staticCtx);
        const elements = scene.getElements();
        for (const el of elements) {
          drawShape(rc, el, themeMode);
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
        interactiveCtx.restore();
      }
      return;
    }

    // Update cursor style based on hover
    if (activeTool === 'select' && selectedIds.length > 0) {
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

    broadcastCursor(point.x, point.y, false);
  };

  const onPointerLeave = () => {
    if (interactionMode === 'panning') return;
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
          for (const id of hitIds) {
            const el = scene.getElement(id);
            if (el && !el.isDeleted) {
              scene.updateElement(id, { isDeleted: true });
            }
          }
          onSceneMutate('update');
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
        roughness: 1,
        opacity: 1,
        version: 1,
        versionNonce: Math.floor(Math.random() * 1e9),
        isDeleted: false,
        groupIds: [],
        index: 0,
        updated: Date.now(),
        ownerId: userId ?? '',
        seed: Math.floor(Math.random() * 1e9),
        content: '',
        fontSize: 20,
        fontFamily: 'sans-serif',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.25,
      };
      scene.addElement(newEl);
      history.push();
      onSceneMutate('add');
      setEditingText({ shapeId: id, x: point.x, y: point.y, content: '', fontSize: 20 });
    } else if (hitEl.type === 'text') {
      const textEl = hitEl as Extract<SceneElement, { type: 'text' }>;
      setEditingText({
        shapeId: textEl.id,
        x: textEl.x,
        y: textEl.y,
        content: textEl.content,
        fontSize: textEl.fontSize,
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
            ? 'cell'
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
        {/* Layer 1: Static (roughjs committed elements) */}
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
      {/* Eraser cursor indicator */}
      {activeTool === 'eraser' && (
        <div
          style={{
            position: 'fixed',
            left: mousePos.current.x * scale + panX - eraserRadius,
            top: mousePos.current.y * scale + panY - eraserRadius,
            width: eraserRadius * 2,
            height: eraserRadius * 2,
            borderRadius: '50%',
            border: '2px solid rgba(0,0,0,0.5)',
            backgroundColor: 'rgba(255,255,255,0.2)',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        />
      )}
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
