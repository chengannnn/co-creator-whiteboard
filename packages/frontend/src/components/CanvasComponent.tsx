import { useEffect, useRef, useCallback, useState } from 'react';
import { RoughCanvas } from 'roughjs/bin/canvas.js';
import { ToolType, Shape, Point, ShapeStyle, DEFAULT_STYLE, TextShape, LineShape } from '../types/shapes';
import { theme } from '../theme';

interface CanvasComponentProps {
  activeTool: ToolType;
  shapes: Shape[];
  onShapesChange: (shapes: Shape[]) => void;
  history: Shape[][];
  onHistoryChange: (history: Shape[][]) => void;
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

export default function CanvasComponent({
  activeTool,
  shapes,
  onShapesChange,
  history,
  onHistoryChange,
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
}: CanvasComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);

  // Keep refs in sync with props
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

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

  // Apply pan/scale transform to canvas context
  const applyCanvasTransform = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(scale, 0, 0, scale, panX, panY);
    },
    [panX, panY, scale]
  );

  // --- Helper functions (must be before redrawCanvas) ---

  const getShapeBounds = (shape: Shape): { x: number; y: number; width: number; height: number } => {
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
    if (shape.type === 'line') {
      return {
        x: Math.min(shape.startX, shape.endX),
        y: Math.min(shape.startY, shape.endY),
        width: Math.abs(shape.endX - shape.startX),
        height: Math.abs(shape.endY - shape.startY),
      };
    }
    // Text shapes: measure content if width is 0 (newly created)
    if (shape.type === 'text' && shape.width === 0 && shape.height === 0) {
      const ctx = canvasRef.current?.getContext('2d');
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
  };

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

  const drawShape = (
    rc: RoughCanvas,
    shape: Shape,
  ) => {
    const style = shape.style ?? DEFAULT_STYLE;
    const opts = {
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      strokeLineDash: style.strokeStyle === 'dashed' ? [8, 6] : undefined,
      fill: style.fillStyle === 'none' ? undefined : style.fillColor,
      fillStyle: style.fillStyle === 'hatch' ? 'cross-hatch' as const : style.fillStyle === 'solid' ? 'solid' as const : undefined,
      hachureAngle: 60,
      hachureGap: style.strokeWidth * 4,
    };

    if (shape.type === 'rectangle') {
      rc.rectangle(shape.x, shape.y, shape.width, shape.height, opts);
    } else if (shape.type === 'ellipse') {
      rc.ellipse(
        shape.x + shape.width / 2,
        shape.y + shape.height / 2,
        Math.abs(shape.width),
        Math.abs(shape.height),
        opts,
      );
    } else if (shape.type === 'freehand') {
      if (shape.points.length > 1) {
        rc.linearPath(shape.points.map((p) => [p.x, p.y]), {
          stroke: style.strokeColor,
          strokeWidth: style.strokeWidth,
          strokeLineDash: style.strokeStyle === 'dashed' ? [8, 6] : undefined,
        });
      }
    } else if (shape.type === 'line') {
      rc.linearPath([[shape.startX, shape.startY], [shape.endX, shape.endY]], {
        stroke: style.strokeColor,
        strokeWidth: style.strokeWidth,
        strokeLineDash: style.strokeStyle === 'dashed' ? [8, 6] : undefined,
      });
    } else if (shape.type === 'text') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && shape.content) {
        ctx.font = `${shape.fontSize}px sans-serif`;
        ctx.fillStyle = style.strokeColor;
        ctx.textBaseline = 'top';
        ctx.fillText(shape.content, shape.x, shape.y);

        // Update shape dimensions based on rendered text
        const metrics = ctx.measureText(shape.content);
        const newWidth = Math.ceil(metrics.width);
        const newHeight = shape.fontSize;
        if (newWidth !== shape.width || newHeight !== shape.height) {
          shape.width = newWidth;
          shape.height = newHeight;
        }
      }
    }
  };

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const roughCanvas = roughCanvasRef.current;
    if (!roughCanvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = theme.canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply pan/scale transform for all drawing
    ctx.save();
    applyCanvasTransform(ctx);

    for (const shape of shapes) {
      drawShape(roughCanvas, shape);
    }

    // Draw colored borders on remote shapes (attribution)
    for (const shape of shapes) {
      const ownerId = shapeOwners.get(shape.id);
      if (ownerId && ownerId !== userId && ownerId !== '__remote__') {
        const bounds = getShapeBounds(shape);
        const borderColor = ownerId.split('-')[0] ?? '#8b5cf6';
        ctx.save();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
        ctx.restore();
      }
    }

    // Draw selection bounding boxes
    for (const selId of selectedIds) {
      const shape = shapes.find((s) => s.id === selId);
      if (!shape) continue;
      const bbox = getBBox(shape);
      if (!bbox) continue;

      // Use owner color for remote shapes, default blue for own shapes
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
  }, [shapes, selectedIds, getBBox, getHandlePositions, userId, shapeOwners, scale, applyCanvasTransform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      roughCanvasRef.current = new RoughCanvas(canvas);
      redrawCanvas();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [shapes, selectedIds, redrawCanvas, scale]);

  // --- Keyboard handlers ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
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
  }, [selectedIds, shapes, undo, pushHistory, onSelectedIdsChange]);

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

  // --- Wheel handler for zoom (native listener for passive: false) ---

  useEffect(() => {
    const canvas = canvasRef.current;
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

      onScaleChange(newScale);
      onPanXChange(newPanX);
      onPanYChange(newPanY);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [onScaleChange, onPanXChange, onPanYChange]);

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
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return screenToWorld(screenX, screenY);
  };

  const finishEditing = () => {
    if (!editingText) return;
    const { shapeId, content } = editingText;
    if (content.trim()) {
      const ctx = canvasRef.current?.getContext('2d');
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

    if (shape.type === 'line') {
      const origBounds = getShapeBounds(shape);
      const offsetX = x - origBounds.x;
      const offsetY = y - origBounds.y;
      return {
        ...shape,
        startX: shape.startX + offsetX,
        startY: shape.startY + offsetY,
        endX: shape.endX + offsetX,
        endY: shape.endY + offsetY,
      } as LineShape;
    }

    return { ...shape, x, y, width, height };
  };

  // --- Mouse handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    // If currently editing text, don't process other mouse events
    if (editingText) return;

    // Eraser tool: delete shape on click
    if (activeTool === 'eraser') {
      const point = getCanvasPoint(e);
      const hitShape = hitTestShapes(point);
      if (hitShape) {
        pushHistory(shapes.filter((s) => s.id !== hitShape.id));
        onSelectedIdsChange(selectedIds.filter((id) => id !== hitShape.id));
      }
      setInteractionMode('drawing');
      return;
    }

    const point = getCanvasPoint(e);

    // Middle-click or space+drag starts panning
    if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
      e.preventDefault();
      panStart.current = { x: e.clientX - panXRef.current, y: e.clientY - panYRef.current };
      if (e.button === 1) isMiddleButton.current = true;
      setInteractionMode("panning");
      return;
    }

    if (activeTool === 'text') {
      // Create a new text shape and start inline editing
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
      return;
    }

    if (activeTool !== 'select') {
      // Drawing mode
      isDrawing.current = true;
      startPoint.current = point;
      currentPoints.current = [point];
      setInteractionMode('drawing');
      return;
    }

    // Select tool
    const handle = hitTestHandles(point);
    const primaryId = selectedIds[selectedIds.length - 1];
    if (handle && primaryId) {
      // Start resizing
      const shape = shapes.find((s) => s.id === primaryId);
      if (shape) {
        const bounds = getShapeBounds(shape);
        resizeStartBounds.current = { ...bounds };
        setActiveHandle(handle);
        setInteractionMode('resizing');
      }
      return;
    }

    const hitShape = hitTestShapes(point);
    if (hitShape) {
      onSelectedIdsChange([hitShape.id]);
      const bounds = getShapeBounds(hitShape);
      moveOffset.current = { x: point.x - bounds.x, y: point.y - bounds.y };
      setInteractionMode('moving');
    } else {
      onSelectedIdsChange([]);
      setInteractionMode('selecting');
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const point = getCanvasPoint(e);

    if (interactionMode === 'drawing') {
      // Eraser: delete shapes under cursor during drag
      if (activeTool === 'eraser') {
        const hitShape = hitTestShapes(point);
        if (hitShape) {
          pushHistory(shapes.filter((s) => s.id !== hitShape.id));
          onSelectedIdsChange(selectedIds.filter((id) => id !== hitShape.id));
        }
        return;
      }

      broadcastCursor(point.x, point.y, true);
      if (activeTool === 'freehand') {
        currentPoints.current.push(point);
        redrawCanvas();

        const rc = roughCanvasRef.current;
        if (rc && currentPoints.current.length > 1) {
          rc.linearPath(currentPoints.current.map((p) => [p.x, p.y]), {
            stroke: defaultStyle.strokeColor,
            strokeWidth: defaultStyle.strokeWidth,
          });
        }
      } else {
        redrawCanvas();

        const rc = roughCanvasRef.current;
        if (!rc) return;
        const start = startPoint.current;
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);

        if (activeTool === 'rectangle') {
          rc.rectangle(x, y, width, height, {
            stroke: defaultStyle.strokeColor,
            strokeWidth: defaultStyle.strokeWidth,
          });
        } else if (activeTool === 'ellipse') {
          rc.ellipse(x + width / 2, y + height / 2, width, height, {
            stroke: defaultStyle.strokeColor,
            strokeWidth: defaultStyle.strokeWidth,
          });
        } else if (activeTool === 'line') {
          rc.linearPath(
            [[start.x, start.y], [point.x, point.y]],
            {
              stroke: defaultStyle.strokeColor,
              strokeWidth: defaultStyle.strokeWidth,
              strokeLineDash: defaultStyle.strokeStyle === 'dashed' ? [8, 6] : undefined,
            },
          );
        }
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
      const newShapes = shapes.map((s) => {
        if (!selectedIdSet.has(s.id)) return s;
        if (s.type === 'freehand') {
          return {
            ...s,
            points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          };
        }
        if (s.type === 'line') {
          return {
            ...s,
            startX: s.startX + dx,
            startY: s.startY + dy,
            endX: s.endX + dx,
            endY: s.endY + dy,
          } as LineShape;
        }
        return { ...s, x: s.x + dx, y: s.y + dy };
      });

      onShapesChange(newShapes);
      return;
    }

    if (interactionMode === 'resizing' && selectedIds.length > 0 && activeHandle) {
      const primaryId = selectedIds[selectedIds.length - 1];
      const shape = shapes.find((s) => s.id === primaryId);
      if (!shape) return;

      const orig = resizeStartBounds.current;
      const dx = point.x - (orig.x + (activeHandle.includes('e') ? orig.width : 0));
      const dy = point.y - (orig.y + (activeHandle.includes('s') ? orig.height : 0));

      const resized = applyResize(shape, activeHandle, dx, dy);
      const newShapes = shapes.map((s) => (s.id === primaryId ? resized : s));
      onShapesChange(newShapes);
      return;
    }

    if (interactionMode === 'panning') {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      onPanXChange(dx);
      onPanYChange(dy);
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
        canvasRef.current!.style.cursor = cursorMap[handle];
        return;
      }
    }

    // Broadcast cursor position for presence
    broadcastCursor(point.x, point.y, false);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const point = getCanvasPoint(e);

    if (interactionMode === 'drawing') {
      isDrawing.current = false;
      const start = startPoint.current;
      let newShape: Shape | null = null;

      if (activeTool === 'rectangle') {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);
        if (width > 3 && height > 3) {
          newShape = { id: generateId(), type: 'rectangle', x, y, width, height, style: { ...defaultStyle } };
        }
      } else if (activeTool === 'ellipse') {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);
        if (width > 3 && height > 3) {
          newShape = { id: generateId(), type: 'ellipse', x, y, width, height, style: { ...defaultStyle } };
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
      // Commit the move/resize to history
      pushHistory([...shapes]);
      setInteractionMode('idle');
      setActiveHandle(null);
      return;
    }

    if (interactionMode === 'panning') {
      isMiddleButton.current = false;
      setInteractionMode('idle');
      return;
    }

    if (interactionMode === 'selecting') {
      setInteractionMode('idle');
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (editingText) return;

    const point = getCanvasPoint(e);
    const hitShape = hitTestShapes(point);

    if (!hitShape) {
      // Double-click on empty canvas resets zoom to 100%
      onScaleChange(1);
      onPanXChange(0);
      onPanYChange(0);
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

  const cursorStyle =
    interactionMode === 'moving'
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
                : activeTool === 'text'
                  ? 'text'
                  : 'crosshair';

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100vw',
          height: '100vh',
          cursor: cursorStyle,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      />
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
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
