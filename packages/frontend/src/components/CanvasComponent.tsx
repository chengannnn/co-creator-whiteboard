import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { RoughCanvas } from 'roughjs/bin/canvas.js';
import { ToolType, Shape, Point, ShapeStyle, DEFAULT_STYLE, TextShape, LineShape, RhombusShape, ArrowShape } from '../types/shapes';
import type { SceneElement, StrokeWidth } from '../types/element';
import { getThemeColors, getStrokeColor, type ThemeMode } from '../theme';

interface CanvasComponentProps {
  activeTool: ToolType;
  shapes: Shape[];
  onShapesChange: (shapes: Shape[]) => void;
  history: Shape[][];
  onHistoryChange: (history: Shape[][]) => void;
  forwardHistory: Shape[][];
  onForwardHistoryChange: (forwardHistory: Shape[][]) => void;
  defaultStyle: ShapeStyle;
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
}

type InteractionMode =
  | 'idle'
  | 'drawing'
  | 'selecting'
  | 'moving'
  | 'resizing'
  | 'panning';

type ResizeHandle =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 's'
  | 'e'
  | 'w';

const HANDLE_SIZE = 8;
const BBOX_PADDING = 6;

// Map solid tool variants to base shape types for drawing/hit-testing logic
const getBaseShapeTool = (tool: ToolType): ToolType => {
  if (tool === 'rectangle-solid') return 'rectangle';
  if (tool === 'ellipse-solid') return 'ellipse';
  if (tool === 'rhombus-solid') return 'rhombus';
  return tool;
};

// Map hex colors to readable names for cursor labels (must match App.tsx mapping)
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

// Compute bounding box of a shape in world coordinates
function getShapeBounds(shape: Shape, canvasEl?: HTMLCanvasElement | null): { x: number; y: number; width: number; height: number } {
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
  // Text shapes: measure content if width is 0 (newly created)
  if (shape.type === 'text' && shape.width === 0 && shape.height === 0) {
    const ctx = canvasEl?.getContext('2d');
    if (ctx && shape.content) {
      ctx.font = `${shape.fontSize}px sans-serif`;
      const metrics = ctx.measureText(shape.content);
      return {
        x: shape.x,
        y: shape.y,
        width: Math.ceil(metrics.width),
        height: shape.fontSize,
      };
    }
    return { x: shape.x, y: shape.y, width: 100, height: shape.fontSize };
  }
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

export interface CanvasComponentRef {
  exportPng: () => void;
  undo: () => void;
  redo: () => void;
}

export default forwardRef<CanvasComponentRef, CanvasComponentProps>(function CanvasComponent({
  activeTool,
  shapes,
  onShapesChange,
  history,
  onHistoryChange,
  forwardHistory,
  onForwardHistoryChange,
  defaultStyle,
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
}: CanvasComponentProps, ref) {
  const theme = getThemeColors(themeMode);
  // Three-layer canvas architecture
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
  const isDrawing = useRef(false);
  const startPoint = useRef<Point>({ x: 0, y: 0 });
  const currentPoints = useRef<Point[]>([]);

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);
  const moveOffset = useRef<Point>({ x: 0, y: 0 });
  const resizeStartBounds = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Inline text editing state
  const [editingText, setEditingText] = useState<{
    shapeId: string;
    x: number;
    y: number;
    content: string;
    fontSize: number;
  } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Pan/zoom interaction refs
  const spacePressed = useRef(false);
  const isMiddleButton = useRef(false);
  const isPanning = useRef(false);
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const zoomCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Intermediate shapes during move/resize — avoids React state mutations on every mouseMove
  const moveShapesRef = useRef<Shape[] | null>(null);

  // Image cache: src -> HTMLImageElement (avoids reloading images on every redraw)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Pixel-based eraser state
  const eraserPoints = useRef<Point[]>([]);
  const lastEraserPoint = useRef<Point | null>(null);
  const mousePos = useRef<Point>({ x: 0, y: 0 });

  // Keep refs in sync with props
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);
  useEffect(() => { if (!moveShapesRef.current) moveShapesRef.current = shapes; }, [shapes]);

  const pushHistory = useCallback(
    (newShapes: Shape[]) => {
      onHistoryChange([...history, shapes]);
      onShapesChange(newShapes);
    },
    [history, shapes, onHistoryChange, onShapesChange]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    onHistoryChange(history.slice(0, -1));
    onShapesChange(previous);
    onSelectedIdsChange([]);
  }, [history, onHistoryChange, onShapesChange, onSelectedIdsChange]);

  const redo = useCallback(() => {
    if (forwardHistory.length === 0) return;
    const next = forwardHistory[forwardHistory.length - 1];
    onForwardHistoryChange(forwardHistory.slice(0, -1));
    onHistoryChange([...history, shapes]);
    onShapesChange(next);
    onSelectedIdsChange([]);
  }, [forwardHistory, onForwardHistoryChange, history, shapes, onHistoryChange, onShapesChange, onSelectedIdsChange]);

  // --- Pan/Zoom helpers ---

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 5;
  const ZOOM_FACTOR = 0.08;

  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Point => {
      return {
        x: (screenX - panX) / scale,
        y: (screenY - panY) / scale,
      };
    },
    [panX, panY, scale]
  );

  // Apply pan/scale transform to canvas context (uses React state)
  const applyCanvasTransform = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(scale, 0, 0, scale, panX, panY);
    },
    [panX, panY, scale]
  );

  // Apply pan/scale transform using ref values (for panning without re-renders)
  const applyCanvasTransformFromRefs = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, panXRef.current, panYRef.current);
    },
    []
  );

  // --- Helper functions (must be before redrawCanvas) ---

  const getBBox = useCallback((shape: Shape | null) => {
    if (!shape) return null;
    const b = getShapeBounds(shape);
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
      const allShapes = shapes;
      if (allShapes.length === 0) return;

      // Compute minimum bounding box of all shapes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const shape of allShapes) {
        const bounds = getShapeBounds(shape);
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

      // Render all shapes
      for (const shape of allShapes) {
        const style = shape.style;
        const strokeColor = getStrokeColor(style.strokeColor, themeMode);
        const fill = style.fillStyle === 'none' ? undefined : style.fillColor;
        const lineDash = style.strokeStyle === 'dashed' ? [8, 6] : undefined;

        switch (shape.type) {
          case 'rectangle':
            rc.rectangle(shape.x, shape.y, shape.width, shape.height, { stroke: strokeColor, strokeWidth: style.strokeWidth, fill, strokeLineDash: lineDash });
            break;
          case 'ellipse':
            rc.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, shape.width, shape.height, { stroke: strokeColor, strokeWidth: style.strokeWidth, fill, strokeLineDash: lineDash });
            break;
          case 'rhombus':
            rc.polygon([
              [shape.x + shape.width / 2, shape.y],
              [shape.x + shape.width, shape.y + shape.height / 2],
              [shape.x + shape.width / 2, shape.y + shape.height],
              [shape.x, shape.y + shape.height / 2],
            ], { stroke: strokeColor, strokeWidth: style.strokeWidth, fill, strokeLineDash: lineDash });
            break;
          case 'line':
            rc.linearPath([[shape.startX, shape.startY], [shape.endX, shape.endY]], { stroke: strokeColor, strokeWidth: style.strokeWidth, strokeLineDash: lineDash });
            break;
          case 'arrow': {
            rc.linearPath([[shape.startX, shape.startY], [shape.endX, shape.endY]], { stroke: strokeColor, strokeWidth: style.strokeWidth, strokeLineDash: lineDash });
            // Arrowhead
            const angle = Math.atan2(shape.endY - shape.startY, shape.endX - shape.startX);
            const headSize = style.strokeWidth * 3;
            ctx.save();
            ctx.fillStyle = strokeColor;
            ctx.translate(shape.endX, shape.endY);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-headSize, -headSize / 2);
            ctx.lineTo(-headSize, headSize / 2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'freehand':
            if (shape.points.length > 1) {
              const pts = shape.points.map((p) => [p.x, p.y] as [number, number]);
              rc.linearPath(pts, { stroke: strokeColor, strokeWidth: style.strokeWidth, roughness: 0.5, strokeLineDash: lineDash });
            }
            break;
          case 'image': {
            const img = imageCacheRef.current.get(shape.src);
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, shape.x, shape.y, shape.width, shape.height);
            }
            break;
          }
          case 'text':
            ctx.save();
            ctx.fillStyle = strokeColor;
            ctx.font = `${shape.fontSize}px sans-serif`;
            ctx.fillText(shape.content, shape.x, shape.y + shape.fontSize);
            ctx.restore();
            break;
        }
      }

      // Draw colored borders on remote shapes
      for (const shape of allShapes) {
        const ownerId = shapeOwners.get(shape.id);
        if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
          const bounds = getShapeBounds(shape);
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
  }), [shapes, userId, shapeOwners, themeMode]);

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
      case 'rectangle':
        rc.rectangle(element.x, element.y, element.width, element.height, opts);
        break;

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
        rc.polygon(
          [
            [cx, cy - hh],
            [cx + hw, cy],
            [cx, cy + hh],
            [cx - hw, cy],
          ],
          opts,
        );
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

  /**
   * Convert a legacy Shape object to SceneElement format.
   * Transitional helper — will be removed once the component fully migrates to SceneElement.
   */
  function shapeToElement(shape: Shape): SceneElement {
    const style = shape.style ?? DEFAULT_STYLE;
    const now = Date.now();

    const commonBase = {
      id: shape.id,
      angle: 0,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      fillStyle: style.fillStyle,
      fillColor: style.fillColor,
      roughness: 1,
      opacity: 1,
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e9),
      isDeleted: false,
      groupIds: [],
      index: 0,
      updated: now,
      ownerId: shape.ownerId ?? '',
      seed: Math.floor(Math.random() * 1e9),
    };

    switch (shape.type) {
      case 'rectangle':
        return { ...commonBase, type: 'rectangle', x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      case 'ellipse':
        return { ...commonBase, type: 'ellipse', x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      case 'rhombus':
        return { ...commonBase, type: 'rhombus', x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      case 'freehand': {
        const xs = shape.points.map((p) => p.x);
        const ys = shape.points.map((p) => p.y);
        return {
          ...commonBase,
          type: 'freehand',
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          points: shape.points,
        };
      }
      case 'line':
        return {
          ...commonBase,
          type: 'line',
          x: shape.startX,
          y: shape.startY,
          width: Math.abs(shape.endX - shape.startX),
          height: Math.abs(shape.endY - shape.startY),
          points: [
            { x: 0, y: 0 },
            { x: shape.endX - shape.startX, y: shape.endY - shape.startY },
          ],
          startArrowhead: null,
          endArrowhead: null,
        };
      case 'arrow':
        return {
          ...commonBase,
          type: 'arrow',
          x: shape.startX,
          y: shape.startY,
          width: Math.abs(shape.endX - shape.startX),
          height: Math.abs(shape.endY - shape.startY),
          points: [
            { x: 0, y: 0 },
            { x: shape.endX - shape.startX, y: shape.endY - shape.startY },
          ],
          startArrowhead: null,
          endArrowhead: 'arrow' as const,
        };
      case 'text':
        return {
          ...commonBase,
          type: 'text',
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          content: shape.content,
          fontSize: shape.fontSize,
          fontFamily: 'sans-serif',
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: 1.25,
        };
      case 'image':
        return {
          ...commonBase,
          type: 'image',
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          src: shape.src,
          fileId: null,
        };
      default:
        throw new Error(`Unknown shape type: ${(shape as Shape & { type: string }).type}`);
    }
  }


  /**
   * Compute bounding box of a SceneElement in world coordinates.
   */
  function getElementBounds(el: SceneElement): { x: number; y: number; width: number; height: number } {
    if (el.type === 'freehand' || el.type === 'line' || el.type === 'arrow') {
      const points = el.points;
      if (points.length === 0) return { x: el.x, y: el.y, width: 0, height: 0 };
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return {
        x: el.x + Math.min(...xs),
        y: el.y + Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    }
    // Text elements: measure content if width is 0
    if (el.type === 'text' && el.width === 0 && el.height === 0) {
      return { x: el.x, y: el.y, width: 100, height: el.fontSize };
    }
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }

  /**
   * Draw a SceneElement using roughjs for the Static canvas layer.
   * Replaces the old drawShape function for committed elements.
   */
  /**
   * Thin wrapper around drawShape for backward compatibility.
   * drawShape now accepts SceneElement directly.
   */
  const drawSceneElement = (
    rc: RoughCanvas,
    el: SceneElement,
    _ctx: CanvasRenderingContext2D,
    themeMode: ThemeMode,
  ) => {
    drawShape(rc, el, themeMode);
  };

  // --- Three-layer canvas rendering ---

  // Layer 0: Background — fills with theme canvas background color
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

    for (const shape of shapes) {
      const el = shapeToElement(shape);
      drawSceneElement(rc, el, ctx, themeMode);
    }

    // Draw colored borders on remote shapes (attribution)
    for (const shape of shapes) {
      const el = shapeToElement(shape);
      const ownerId = shapeOwners.get(shape.id);
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
  }, [shapes, applyCanvasTransform, shapeOwners, userId, scale]);

  // Layer 2: Interactive — renders draft elements, selection, resize handles, remote cursors
  const renderInteractive = useCallback(() => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    applyCanvasTransform(ctx);

    // Draw draft element if drawing (uses refs updated by handleMouseMove)
    if (interactionMode === 'drawing') {
      const baseTool = getBaseShapeTool(activeTool);
      if (baseTool === 'freehand' && currentPoints.current.length > 1) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = getStrokeColor(DEFAULT_STYLE.strokeColor, themeMode);
        ctx.lineWidth = DEFAULT_STYLE.strokeWidth;
        ctx.beginPath();
        ctx.moveTo(currentPoints.current[0].x, currentPoints.current[0].y);
        for (let i = 1; i < currentPoints.current.length; i++) {
          ctx.lineTo(currentPoints.current[i].x, currentPoints.current[i].y);
        }
        ctx.stroke();
        ctx.restore();
      } else if (baseTool === 'eraser' && eraserPoints.current.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const pt of eraserPoints.current) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, eraserRadius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,1)';
          ctx.fill();
        }
        if (eraserPoints.current.length > 1) {
          ctx.lineWidth = eraserRadius * 2;
          ctx.strokeStyle = 'rgba(0,0,0,1)';
          ctx.beginPath();
          ctx.moveTo(eraserPoints.current[0].x, eraserPoints.current[0].y);
          for (let i = 1; i < eraserPoints.current.length; i++) {
            ctx.lineTo(eraserPoints.current[i].x, eraserPoints.current[i].y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      // Note: rectangle/ellipse/rhombus/line/arrow previews are drawn directly in handleMouseMove
      // on the interactive canvas during drag, avoiding the need for intermediate point refs
    }

    // Draw selection bounding boxes and resize handles
    for (const selId of selectedIds) {
      const shape = shapes.find((s) => s.id === selId);
      if (!shape) continue;
      const bbox = getBBox(shape);
      if (!bbox) continue;

      const ownerId = shapeOwners.get(shape.id);
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

    // Pixel-based eraser on interactive canvas during eraser drag
    if (interactionMode === 'drawing' && activeTool === 'eraser' && eraserPoints.current.length > 0) {
      const rc = roughCanvasRef.current;
      if (rc) {
        renderStaticScene();
      }
    }
  }, [interactionMode, activeTool, selectedIds, shapes, getBBox, getHandlePositions, shapeOwners, userId, scale, themeMode, eraserRadius, renderStaticScene, applyCanvasTransform]);

  // Master redraw — redraws static and interactive layers
  const redrawCanvas = useCallback(() => {
    renderStaticScene();
    renderInteractive();
  }, [renderStaticScene, renderInteractive]);

  // Full redraw including background
  const redrawAll = useCallback(() => {
    renderBackground();
    renderStaticScene();
    renderInteractive();
  }, [renderBackground, renderStaticScene, renderInteractive]);

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

  useEffect(() => {
    redrawCanvas();
  }, [shapes, selectedIds, redrawCanvas, scale]);

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
        const selectedIdSet = new Set(selectedIds);
        pushHistory(shapes.filter((s) => !selectedIdSet.has(s.id)));
        onSelectedIdsChange([]);
      }

      if (e.key === 'Escape') {
        onSelectedIdsChange([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, shapes, undo, pushHistory, onSelectedIdsChange, locked]);

  // Track space key state for pan modifier
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
  }, [editingText, shapes]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // --- Wheel handler for zoom (uses refs to avoid re-renders during zoom) ---

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

      // Update refs immediately for jitter-free rendering
      scaleRef.current = newScale;
      panXRef.current = newPanX;
      panYRef.current = newPanY;

      // Redraw immediately with ref-based transform
      const roughCanvas = roughCanvasRef.current;
      if (!roughCanvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const activeShapes = moveShapesRef.current ?? shapes;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = theme.canvasBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      applyCanvasTransformFromRefs(ctx);

      for (const shape of activeShapes) {
        drawShape(roughCanvas, shapeToElement(shape), themeMode);
      }

      // Draw colored borders on remote shapes
      for (const shape of activeShapes) {
        const ownerId = shapeOwners.get(shape.id);
        if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
          const bounds = getShapeBounds(shape);
          const borderColor = ownerId.split('-')[0] ?? '#8b5cf6';
          ctx.save();
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 2 / newScale;
          ctx.setLineDash([]);
          ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
          ctx.restore();
        }
      }

      // Draw selection bounding boxes
      for (const selId of selectedIds) {
        const shape = activeShapes.find((s) => s.id === selId);
        if (!shape) continue;
        const bbox = getBBox(shape);
        if (!bbox) continue;

        const ownerId = shapeOwners.get(shape.id);
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

      // Update remote cursors position (they use scale/pan from props)
      // Debounce state sync — commit after zoom pauses
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
  }, [shapes, selectedIds, getBBox, getHandlePositions, userId, shapeOwners, applyCanvasTransformFromRefs, commitZoomToState, themeMode]);

  // --- Shape hit detection ---

  const hitTestShapes = (point: Point): Shape | null => {
    // Test in reverse order (top-most first)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      const bounds = getShapeBounds(shape);

      if (shape.type === 'freehand') {
        // Point-in-polygon approximation for freehand
        if (isPointInFreehand(shape, point)) return shape;
      } else {
        if (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        ) {
          return shape;
        }
      }    }
    return null;
  };

  const isPointInFreehand = (shape: { points: Point[] }, point: Point): boolean => {
    // Ray casting algorithm
    const pts = shape.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x,
        yi = pts[i].y;
      const xj = pts[j].x,
        yj = pts[j].y;
      if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  // --- Resize handle hit detection ---

  const hitTestHandles = (point: Point): ResizeHandle | null => {
    const primaryId = selectedIds[selectedIds.length - 1];
    if (!primaryId) return null;
    const selected = shapes.find((s) => s.id === primaryId);
    if (!selected) return null;
    const bbox = getBBox(selected);
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
        return handle as ResizeHandle;
      }
    }
    return null;
  };

  // --- Mouse event helpers ---

  const getCanvasPoint = (e: React.MouseEvent): Point => {
    const canvas = interactiveCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return screenToWorld(screenX, screenY);
  };

  /**
   * Convert pointer event to world coordinates using refs (no re-render).
   * Used by unified pointer event pipeline for consistent coordinate mapping.
   */
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
      onShapesChange(
        shapes.map((s) =>
          s.id === shapeId
            ? { ...s, content: content.trim(), width, height }
            : s
        )
      );
    } else {
      // Remove empty text shapes
      pushHistory(shapes.filter((s) => s.id !== shapeId));
    }
    setEditingText(null);
  };

  const cancelEditing = () => {
    if (!editingText) return;
    // Remove the text shape if content is empty
    if (!editingText.content.trim()) {
      pushHistory(shapes.filter((s) => s.id !== editingText.shapeId));
    }
    setEditingText(null);
  };

  const applyResize = (
    shape: Shape,
    handle: ResizeHandle,
    dx: number,
    dy: number
  ): Shape => {
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

    // Prevent negative dimensions
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
      const offsetX = x - origBounds.x;
      const offsetY = y - origBounds.y;
      return {
        ...shape,
        points: shape.points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
      };
    }

    if (shape.type === 'line' || shape.type === 'arrow') {
      const origBounds = getShapeBounds(shape);
      const offsetX = x - origBounds.x;
      const offsetY = y - origBounds.y;
      return {
        ...shape,
        startX: shape.startX + offsetX,
        startY: shape.startY + offsetY,
        endX: shape.endX + offsetX,
        endY: shape.endY + offsetY,
      } as LineShape | ArrowShape;
    }

    return { ...shape, x, y, width, height };
  };

  // --- Unified pointer event pipeline ---
  // All pointer events convert screen -> world coordinates and dispatch to ToolHandler
  // based on activeTool. Canvas lock only allows panning.

  const onPointerDown = (e: React.PointerEvent) => {
    // If currently editing text, don't process other pointer events
    if (editingText) return;

    // Capture pointer to ensure all subsequent events go to this element
    // even if pointer moves outside the canvas boundary
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const world = getWorldPoint(e);

    // When locked, only panning is allowed — block all other interactions
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

    // Eraser tool: start pixel erase mode
    if (activeTool === 'eraser') {
      isDrawing.current = true;
      startPoint.current = world;
      eraserPoints.current = [world];
      lastEraserPoint.current = world;
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
      // Drawing mode
      isDrawing.current = true;
      startPoint.current = world;
      currentPoints.current = [world];
      setInteractionMode('drawing');
      return;
    }

    // Select tool: hit-testing, resize handle detection, move/resize mode entry
    const handle = hitTestHandles(world);
    const primaryId = selectedIds[selectedIds.length - 1];
    if (handle && primaryId) {
      const shape = shapes.find((s) => s.id === primaryId);
      if (shape) {
        const bounds = getShapeBounds(shape);
        resizeStartBounds.current = { ...bounds };
        setActiveHandle(handle);
        setInteractionMode('resizing');
      }
      return;
    }

    const hitShape = hitTestShapes(world);
    if (hitShape) {
      onSelectedIdsChange([hitShape.id]);
      const bounds = getShapeBounds(hitShape);
      moveOffset.current = { x: world.x - bounds.x, y: world.y - bounds.y };
      setInteractionMode('moving');
    } else {
      onSelectedIdsChange([]);
      setInteractionMode('selecting');
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // When locked and not panning, ignore all pointer moves
    if (locked && !isPanning.current) return;

    const point = getWorldPoint(e);
    mousePos.current = point;

    if (interactionMode === 'drawing') {
      // Eraser: track points for pixel-level erasing
      if (activeTool === 'eraser') {
        const prev = lastEraserPoint.current;
        if (prev) {
          // Interpolate for smooth continuous erase
          const dx = point.x - prev.x;
          const dy = point.y - prev.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const step = Math.max(1, eraserRadius / 3);
          const numSteps = Math.max(1, Math.ceil(dist / step));
          for (let i = 1; i <= numSteps; i++) {
            const t = i / numSteps;
            eraserPoints.current.push({
              x: prev.x + dx * t,
              y: prev.y + dy * t,
            });
          }
        }
        lastEraserPoint.current = point;
        redrawCanvas();
        return;
      }

      broadcastCursor(point.x, point.y, true);
      if (activeTool === 'freehand') {
        currentPoints.current.push(point);
        redrawCanvas();

        // Draw freehand preview on interactive canvas
        const ctx = interactiveCanvasRef.current?.getContext('2d');
        if (ctx && currentPoints.current.length > 1) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = getStrokeColor(defaultStyle.strokeColor, themeMode);
          ctx.lineWidth = defaultStyle.strokeWidth;
          ctx.beginPath();
          ctx.moveTo(currentPoints.current[0].x, currentPoints.current[0].y);
          for (let i = 1; i < currentPoints.current.length; i++) {
            ctx.lineTo(currentPoints.current[i].x, currentPoints.current[i].y);
          }
          ctx.stroke();
          ctx.restore();
        }
      } else {
        redrawCanvas();

        // Draw shape preview on interactive canvas
        const ctx = interactiveCanvasRef.current?.getContext('2d');
        if (!ctx) return;
        const start = startPoint.current;
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);

        const baseTool = getBaseShapeTool(activeTool);
        ctx.save();
        ctx.strokeStyle = getStrokeColor(defaultStyle.strokeColor, themeMode);
        ctx.lineWidth = defaultStyle.strokeWidth;
        if (defaultStyle.strokeStyle === 'dashed') ctx.setLineDash([8, 6]);

        if (baseTool === 'rectangle') {
          ctx.strokeRect(x, y, width, height);
        } else if (baseTool === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (baseTool === 'rhombus') {
          const cx = x + width / 2;
          const cy = y + height / 2;
          const hw = width / 2;
          const hh = height / 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy - hh);
          ctx.lineTo(cx + hw, cy);
          ctx.lineTo(cx, cy + hh);
          ctx.lineTo(cx - hw, cy);
          ctx.closePath();
          ctx.stroke();
        } else if (baseTool === 'line') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        } else if (baseTool === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
          // Draw arrowhead preview
          const angle = Math.atan2(point.y - start.y, point.x - start.x);
          const arrowheadSize = defaultStyle.strokeWidth * 3;
          ctx.fillStyle = getStrokeColor(defaultStyle.strokeColor, themeMode);
          ctx.translate(point.x, point.y);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-arrowheadSize, -arrowheadSize / 2);
          ctx.lineTo(-arrowheadSize, arrowheadSize / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      return;
    }

    if (interactionMode === 'moving' && selectedIds.length > 0) {
      const primaryId = selectedIds[selectedIds.length - 1];
      const primaryShape = shapes.find((s) => s.id === primaryId);
      if (!primaryShape) return;

      const bounds = getShapeBounds(primaryShape);
      const newX = point.x - moveOffset.current.x;
      const newY = point.y - moveOffset.current.y;
      const dx = newX - bounds.x;
      const dy = newY - bounds.y;

      // Only apply offset if there's actual movement
      if (dx === 0 && dy === 0) return;

      const selectedIdSet = new Set(selectedIds);
      const currentShapes = moveShapesRef.current ?? shapes;
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
          } as LineShape | ArrowShape;
        }
        return { ...s, x: s.x + dx, y: s.y + dy };
      });

      moveShapesRef.current = newShapes;
      redrawCanvas();
      return;
    }

    if (interactionMode === 'resizing' && selectedIds.length > 0 && activeHandle) {
      const primaryId = selectedIds[selectedIds.length - 1];
      const currentShapes = moveShapesRef.current ?? shapes;
      const shape = currentShapes.find((s) => s.id === primaryId);
      if (!shape) return;

      const orig = resizeStartBounds.current;
      const dx = point.x - (orig.x + (activeHandle.includes('e') ? orig.width : 0));
      const dy = point.y - (orig.y + (activeHandle.includes('s') ? orig.height : 0));

      const resized = applyResize(shape, activeHandle, dx, dy);
      const newShapes = currentShapes.map((s) => (s.id === primaryId ? resized : s));
      moveShapesRef.current = newShapes;
      redrawCanvas();
      return;
    }

    if (interactionMode === 'panning') {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      // Update refs and redraw using ref-based transform — avoid React state re-renders during panning
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

        // Redraw background
        bgCtx.fillStyle = theme.canvasBg;
        bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        // Redraw static layer
        staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
        staticCtx.save();
        applyCanvasTransformFromRefs(staticCtx);
        for (const shape of shapes) {
          drawShape(rc, shapeToElement(shape), themeMode);
        }
        for (const shape of shapes) {
          const ownerId = shapeOwners.get(shape.id);
          if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
            const bounds = getShapeBounds(shape);
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

        // Redraw interactive layer (selection, handles)
        interactiveCtx.clearRect(0, 0, interactiveCanvas.width, interactiveCanvas.height);
        interactiveCtx.save();
        applyCanvasTransformFromRefs(interactiveCtx);
        for (const selId of selectedIds) {
          const shape = shapes.find((s) => s.id === selId);
          if (!shape) continue;
          const bbox = getBBox(shape);
          if (!bbox) continue;
          const ownerId = shapeOwners.get(shape.id);
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
        const cursorMap: Record<ResizeHandle, string> = {
          nw: 'nwse-resize',
          se: 'nwse-resize',
          ne: 'nesw-resize',
          sw: 'nesw-resize',
          n: 'ns-resize',
          s: 'ns-resize',
          e: 'ew-resize',
          w: 'ew-resize',
        };
        interactiveCanvasRef.current!.style.cursor = cursorMap[handle];
        return;
      }
    }

    // Broadcast cursor position for presence
    broadcastCursor(point.x, point.y, false);
  };

  /**
   * Handle pointer leaving the canvas — broadcast cursor leave for presence.
   */
  const onPointerLeave = () => {
    if (interactionMode === 'panning') return;
    // Signal cursor left the canvas (useful for remote presence)
    broadcastCursor(mousePos.current.x, mousePos.current.y, false);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // Release pointer capture set in onPointerDown
    const target = e.currentTarget;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }

    const point = getWorldPoint(e);

    if (interactionMode === 'drawing') {
      isDrawing.current = false;

      // Eraser: finalize pixel erase (shapes data unchanged in MVP scope)
      if (activeTool === 'eraser') {
        setInteractionMode('idle');
        return;
      }

      const start = startPoint.current;
      let newShape: Shape | null = null;

      const baseTool = getBaseShapeTool(activeTool);

      if (baseTool === 'rectangle') {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);
        if (width > 3 && height > 3) {
          newShape = { id: generateId(), type: 'rectangle', x, y, width, height, style: { ...defaultStyle } };
        }
      } else if (baseTool === 'ellipse') {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);
        if (width > 3 && height > 3) {
          newShape = { id: generateId(), type: 'ellipse', x, y, width, height, style: { ...defaultStyle } };
        }
      } else if (baseTool === 'rhombus') {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);
        if (width > 3 && height > 3) {
          newShape = { id: generateId(), type: 'rhombus', x, y, width, height, style: { ...defaultStyle } } as RhombusShape;
        }
      } else if (activeTool === 'freehand') {
        if (currentPoints.current.length > 2) {
          newShape = {
            id: generateId(),
            type: 'freehand',
            points: [...currentPoints.current],
            style: { ...defaultStyle },
          };
        }
      } else if (activeTool === 'line') {
        const dx = Math.abs(point.x - start.x);
        const dy = Math.abs(point.y - start.y);
        if (dx > 3 || dy > 3) {
          newShape = {
            id: generateId(),
            type: 'line',
            startX: start.x,
            startY: start.y,
            endX: point.x,
            endY: point.y,
            style: { ...defaultStyle },
          } as LineShape;
        }
      } else if (activeTool === 'arrow') {
        const dx = Math.abs(point.x - start.x);
        const dy = Math.abs(point.y - start.y);
        if (dx > 3 || dy > 3) {
          newShape = {
            id: generateId(),
            type: 'arrow',
            startX: start.x,
            startY: start.y,
            endX: point.x,
            endY: point.y,
            style: { ...defaultStyle },
          } as ArrowShape;
        }
      }

      if (newShape) {
        pushHistory([...shapes, newShape]);
        onSelectedIdsChange([newShape.id]);
      } else {
        redrawCanvas();
      }

      setInteractionMode('idle');
      return;
    }

    if (interactionMode === 'moving' || interactionMode === 'resizing') {
      // Commit intermediate shapes to React state (triggers WebSocket broadcast once)
      const finalShapes = moveShapesRef.current ?? shapes;
      pushHistory(finalShapes);
      moveShapesRef.current = null;
      setInteractionMode('idle');
      setActiveHandle(null);
      return;
    }

    if (interactionMode === 'panning') {
      // Sync pan/panY to parent state after panning completes
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

    const point = getCanvasPoint(e);
    const hitShape = hitTestShapes(point);

    if (!hitShape) {
      // Double-click on empty canvas opens inline text editor
      const id = generateId();
      const newShape: TextShape = {
        id,
        type: 'text',
        x: point.x,
        y: point.y,
        width: 0,
        height: 20,
        content: '',
        fontSize: 20,
        style: { ...defaultStyle },
      };
      pushHistory([...shapes, newShape]);
      setEditingText({ shapeId: id, x: point.x, y: point.y, content: '', fontSize: 20 });
    } else if (hitShape.type === 'text') {
      const textShape = hitShape as TextShape;
      setEditingText({
        shapeId: textShape.id,
        x: textShape.x,
        y: textShape.y,
        content: textShape.content,
        fontSize: textShape.fontSize,
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
              {/* Pointer cursor */}
              <path
                d="M2 2 L2 18 L6.5 13.5 L10.5 20 L13 18.5 L9 12.5 L15 12.5 Z"
                fill={cursor.color}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              {/* Pencil indicator when drawing */}
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
