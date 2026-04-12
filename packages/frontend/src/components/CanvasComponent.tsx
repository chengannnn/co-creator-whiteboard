import { useEffect, useRef, useCallback, useState } from 'react';
import { RoughCanvas } from 'roughjs/bin/canvas.js';
import { ToolType, Shape, Point } from '../types/shapes';

interface CanvasComponentProps {
  activeTool: ToolType;
  shapes: Shape[];
  onShapesChange: (shapes: Shape[]) => void;
  history: Shape[][];
  onHistoryChange: (history: Shape[][]) => void;
}

type InteractionMode =
  | 'idle'
  | 'drawing'
  | 'selecting'
  | 'moving'
  | 'resizing';

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

export default function CanvasComponent({
  activeTool,
  shapes,
  onShapesChange,
  history,
  onHistoryChange,
}: CanvasComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
  const isDrawing = useRef(false);
  const startPoint = useRef<Point>({ x: 0, y: 0 });
  const currentPoints = useRef<Point[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);
  const moveOffset = useRef<Point>({ x: 0, y: 0 });
  const resizeStartBounds = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

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
    setSelectedId(null);
  }, [history, onHistoryChange, onShapesChange]);

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
    strokeColor = '#000000'
  ) => {
    if (shape.type === 'rectangle') {
      rc.rectangle(shape.x, shape.y, shape.width, shape.height, {
        stroke: strokeColor,
        strokeWidth: 2,
      });
    } else if (shape.type === 'ellipse') {
      rc.ellipse(
        shape.x + shape.width / 2,
        shape.y + shape.height / 2,
        Math.abs(shape.width),
        Math.abs(shape.height),
        {
          stroke: strokeColor,
          strokeWidth: 2,
        }
      );
    } else if (shape.type === 'freehand') {
      if (shape.points.length > 1) {
        rc.linearPath(shape.points.map((p) => [p.x, p.y]), {
          stroke: strokeColor,
          strokeWidth: 2,
        });
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
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const shape of shapes) {
      drawShape(roughCanvas, shape);
    }

    // Draw selection bounding box
    if (selectedId) {
      const shape = shapes.find((s) => s.id === selectedId);
      if (!shape) return;
      const bbox = getBBox(shape);
      if (!bbox) return;

      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
      ctx.setLineDash([]);

      const handles = getHandlePositions(bbox);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;

      for (const pos of Object.values(handles)) {
        ctx.fillRect(pos.x, pos.y, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(pos.x, pos.y, HANDLE_SIZE, HANDLE_SIZE);
      }

      ctx.restore();
    }
  }, [shapes, selectedId, getBBox, getHandlePositions]);

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
  }, [shapes, selectedId, redrawCanvas]);

  // --- Keyboard handlers ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        pushHistory(shapes.filter((s) => s.id !== selectedId));
        setSelectedId(null);
      }

      if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, shapes, undo, pushHistory]);

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
      }
    }
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
    const selected = shapes.find((s) => s.id === selectedId);
    if (!selected) return null;
    const bbox = getBBox(selected);
    if (!bbox) return null;
    const handles = getHandlePositions(bbox);

    for (const [handle, pos] of Object.entries(handles)) {
      if (
        point.x >= pos.x &&
        point.x <= pos.x + HANDLE_SIZE &&
        point.y >= pos.y &&
        point.y <= pos.y + HANDLE_SIZE
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
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
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

    return { ...shape, x, y, width, height };
  };

  // --- Mouse handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    const point = getCanvasPoint(e);

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
    if (handle && selectedId) {
      // Start resizing
      const shape = shapes.find((s) => s.id === selectedId);
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
      setSelectedId(hitShape.id);
      const bounds = getShapeBounds(hitShape);
      moveOffset.current = { x: point.x - bounds.x, y: point.y - bounds.y };
      setInteractionMode('moving');
    } else {
      setSelectedId(null);
      setInteractionMode('selecting');
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const point = getCanvasPoint(e);

    if (interactionMode === 'drawing') {
      if (activeTool === 'freehand') {
        currentPoints.current.push(point);
        redrawCanvas();

        const rc = roughCanvasRef.current;
        if (rc && currentPoints.current.length > 1) {
          rc.linearPath(currentPoints.current.map((p) => [p.x, p.y]), {
            stroke: '#000000',
            strokeWidth: 2,
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
            stroke: '#000000',
            strokeWidth: 2,
          });
        } else if (activeTool === 'ellipse') {
          rc.ellipse(x + width / 2, y + height / 2, width, height, {
            stroke: '#000000',
            strokeWidth: 2,
          });
        }
      }
      return;
    }

    if (interactionMode === 'moving' && selectedId) {
      const shape = shapes.find((s) => s.id === selectedId);
      if (!shape) return;

      const bounds = getShapeBounds(shape);
      const newX = point.x - moveOffset.current.x;
      const newY = point.y - moveOffset.current.y;
      const dx = newX - bounds.x;
      const dy = newY - bounds.y;

      const newShapes = shapes.map((s) => {
        if (s.id !== selectedId) return s;
        if (s.type === 'freehand') {
          return {
            ...s,
            points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          };
        }
        return { ...s, x: s.x + dx, y: s.y + dy };
      });

      onShapesChange(newShapes);
      return;
    }

    if (interactionMode === 'resizing' && selectedId && activeHandle) {
      const shape = shapes.find((s) => s.id === selectedId);
      if (!shape) return;

      const orig = resizeStartBounds.current;
      const dx = point.x - (orig.x + (activeHandle.includes('e') ? orig.width : 0));
      const dy = point.y - (orig.y + (activeHandle.includes('s') ? orig.height : 0));

      const resized = applyResize(shape, activeHandle, dx, dy);
      const newShapes = shapes.map((s) => (s.id === selectedId ? resized : s));
      onShapesChange(newShapes);
      return;
    }

    // Update cursor style based on hover
    if (activeTool === 'select' && selectedId) {
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
          newShape = { id: generateId(), type: 'rectangle', x, y, width, height };
        }
      } else if (activeTool === 'ellipse') {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);
        const width = Math.abs(point.x - start.x);
        const height = Math.abs(point.y - start.y);
        if (width > 3 && height > 3) {
          newShape = { id: generateId(), type: 'ellipse', x, y, width, height };
        }
      } else if (activeTool === 'freehand') {
        if (currentPoints.current.length > 2) {
          newShape = {
            id: generateId(),
            type: 'freehand',
            points: [...currentPoints.current],
          };
        }
      }

      if (newShape) {
        pushHistory([...shapes, newShape]);
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

    if (interactionMode === 'selecting') {
      setInteractionMode('idle');
    }
  };

  const cursorStyle =
    interactionMode === 'moving'
      ? 'move'
      : interactionMode === 'resizing'
        ? 'crosshair'
        : activeTool === 'select'
          ? 'default'
          : 'crosshair';

  return (
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
    />
  );
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
