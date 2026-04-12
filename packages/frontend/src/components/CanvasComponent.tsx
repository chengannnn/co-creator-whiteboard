import { useEffect, useRef, useCallback } from 'react';
import { RoughCanvas } from 'roughjs/bin/canvas.js';
import { ToolType, Shape, Point } from '../types/shapes';

interface CanvasComponentProps {
  activeTool: ToolType;
  shapes: Shape[];
  onShapesChange: (shapes: Shape[]) => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export default function CanvasComponent({
  activeTool,
  shapes,
  onShapesChange,
}: CanvasComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
  const isDrawing = useRef(false);
  const startPoint = useRef<Point>({ x: 0, y: 0 });
  const currentPoints = useRef<Point[]>([]);

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
  }, [shapes]);

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
  }, [shapes, redrawCanvas]);

  const getCanvasPoint = (e: React.MouseEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'select') return;

    const point = getCanvasPoint(e);
    isDrawing.current = true;
    startPoint.current = point;
    currentPoints.current = [point];
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing.current) return;

    const point = getCanvasPoint(e);

    if (activeTool === 'freehand') {
      currentPoints.current.push(point);
      redrawCanvas();

      // Draw current stroke preview
      const rc = roughCanvasRef.current;
      if (rc && currentPoints.current.length > 1) {
        rc.linearPath(currentPoints.current.map((p) => [p.x, p.y]), {
          stroke: '#000000',
          strokeWidth: 2,
        });
      }
    } else {
      redrawCanvas();

      // Draw shape preview
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
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    const point = getCanvasPoint(e);
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
      onShapesChange([...shapes, newShape]);
    } else {
      redrawCanvas();
    }
  };

  const cursorStyle =
    activeTool === 'select'
      ? 'default'
      : activeTool === 'freehand'
        ? 'crosshair'
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
