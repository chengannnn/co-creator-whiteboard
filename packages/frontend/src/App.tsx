import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import BottomPanel from './components/BottomPanel';
import UnifiedToolbar from './components/UnifiedToolbar';
import CanvasComponent from './components/CanvasComponent';
import { ToolType, Shape, ShapeStyle, FillStyle, DEFAULT_STYLE, ImageShape, StrokeWidth, StrokeStyle } from './types/shapes';

interface RemoteCursor {
  userId: string;
  x: number;
  y: number;
  color: string;
  name: string;
  isDrawing: boolean;
}

const CURSOR_BROADCAST_THROTTLE = 33; // ~30fps

const RECONNECT_BASE_DELAY = 500;
const RECONNECT_MAX_DELAY = 5000;

function WhiteboardRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const [activeTool, setActiveTool] = useState<ToolType>('rectangle');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [forwardHistory, setForwardHistory] = useState<Shape[][]>([]);
  const [defaultStyle, setDefaultStyle] = useState<ShapeStyle>(DEFAULT_STYLE);
  const [unifiedColor, setUnifiedColor] = useState<string>(DEFAULT_STYLE.strokeColor);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [userCount, setUserCount] = useState(1);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  // User identity (assigned by server)
  const [userId, setUserId] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<string>('#3b82f6');
  const [userName, setUserName] = useState<string>('');

  // Shape ownership: shapeId -> userId (for colored borders on others' shapes)
  const [shapeOwners, setShapeOwners] = useState<Map<string, string>>(new Map());

  // Remote cursors
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const lastCursorBroadcast = useRef(0);

  // Pan/zoom (per-user, not shared)
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [scale, setScale] = useState(1);

  // Eraser radius (default 20px)
  const [eraserRadius, setEraserRadius] = useState(20);

  // Canvas lock (no drawing/select/move, pan/zoom still work)
  const [locked, setLocked] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  const userIdRef = useRef<string | null>(null);
  const userColorRef = useRef<string>('#3b82f6');
  const isRemoteUpdate = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    userColorRef.current = userColor;
  }, [userColor]);

  // Send shape mutation over WebSocket
  const sendShapeMutation = useCallback((type: string, data: { shape?: Shape; shapeId?: string }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, []);

  // WebSocket connection with reconnect logic
  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = protocol + '//' + (window.location.host || 'localhost:3001') + '/ws';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempts.current = 0;
        setWsStatus('connected');
        ws.send(JSON.stringify({ type: 'join_room', roomId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'user_count') {
            setUserCount(msg.count);
          } else if (msg.type === 'user_identity') {
            const id = msg.color + '-' + msg.name;
            setUserId(id);
            setUserColor(msg.color);
            setUserName(msg.name);
          } else if (msg.type === 'sync_state' && Array.isArray(msg.shapes)) {
            setShapes(msg.shapes);
            setHistory([]);
            setForwardHistory([]);
            setSelectedIds([]);
            const owners = new Map<string, string>();
            for (const s of msg.shapes) {
              owners.set(s.id, '__remote__');
            }
            setShapeOwners(owners);
            setRemoteCursors(new Map());
          } else if (msg.type === 'shape_create' && msg.shape) {
            isRemoteUpdate.current = true;
            setShapes((prev) => [...prev, msg.shape]);
            setShapeOwners((prev) => {
              const next = new Map(prev);
              next.set(msg.shape.id, msg.userId ?? '__unknown__');
              return next;
            });
          } else if (msg.type === 'shape_update' && msg.shape) {
            isRemoteUpdate.current = true;
            setShapes((prev) =>
              prev.map((s) => (s.id === msg.shape.id ? msg.shape : s))
            );
          } else if (msg.type === 'shape_delete' && msg.shapeId) {
            isRemoteUpdate.current = true;
            setShapes((prev) => prev.filter((s) => s.id !== msg.shapeId));
            setSelectedIds((prev) => prev.filter((id) => id !== msg.shapeId));
            setShapeOwners((prev) => {
              const next = new Map(prev);
              next.delete(msg.shapeId);
              return next;
            });
          } else if (msg.type === 'cursor_position' && msg.userId !== userIdRef.current) {
            setRemoteCursors((prev) => {
              const next = new Map(prev);
              next.set(msg.userId, {
                userId: msg.userId,
                x: msg.x,
                y: msg.y,
                color: msg.color,
                name: msg.name,
                isDrawing: msg.isDrawing ?? false,
              });
              return next;
            });
          } else if (msg.type === 'cursor_leave' && msg.userId) {
            setRemoteCursors((prev) => {
              const next = new Map(prev);
              next.delete(msg.userId);
              return next;
            });
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        setWsStatus('reconnecting');
        const delay = Math.min(
          RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts.current),
          RECONNECT_MAX_DELAY
        );
        reconnectAttempts.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (cancelled) return;
        setWsStatus('reconnecting');
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
    };
  }, [roomId]);

  // Wrap onShapesChange to also broadcast mutations
  const onShapesChange = useCallback(
    (updater: Shape[] | ((prev: Shape[]) => Shape[])) => {
      const prevShapes = shapesRef.current;
      const nextShapes = typeof updater === 'function' ? updater(prevShapes) : updater;

      if (isRemoteUpdate.current) {
        isRemoteUpdate.current = false;
        setShapes(nextShapes);
        return;
      }

      // Determine diff and broadcast
      if (nextShapes.length > prevShapes.length) {
        const newShape = nextShapes.find((s) => !prevShapes.some((p) => p.id === s.id));
        if (newShape) {
          sendShapeMutation('shape_create', { shape: newShape });
          setShapeOwners((prev) => {
            const next = new Map(prev);
            next.set(newShape.id, userIdRef.current ?? '__local__');
            return next;
          });
        }
      } else if (nextShapes.length < prevShapes.length) {
        const deletedId = prevShapes.find((s) => !nextShapes.some((p) => p.id === s.id))?.id;
        if (deletedId) {
          sendShapeMutation('shape_delete', { shapeId: deletedId });
          setShapeOwners((prev) => {
            const next = new Map(prev);
            next.delete(deletedId);
            return next;
          });
        }
      } else {
        for (let i = 0; i < nextShapes.length; i++) {
          if (nextShapes[i] !== prevShapes[i]) {
            sendShapeMutation('shape_update', { shape: nextShapes[i] });
            break;
          }
        }
      }

      setShapes(nextShapes);
    },
    [sendShapeMutation]
  );

  // Unified toolbar: update selected shapes or set defaults for new shapes
  const handleStyleChange = (patch: { strokeWidth?: StrokeWidth; strokeStyle?: StrokeStyle }) => {
    setDefaultStyle((prev) => {
      const next = { ...prev, ...patch };
      if (selectedIds.length > 0) {
        onShapesChange((prevShapes) =>
          prevShapes.map((s) =>
            selectedIds.includes(s.id) ? { ...s, style: { ...s.style, ...patch } } : s
          )
        );
      }
      return next;
    });
  };

  // Toolbar: set fillStyle when clicking outline/solid shape buttons
  const handleFillStyleChange = (fill: FillStyle) => {
    setDefaultStyle((prev) => ({ ...prev, fillStyle: fill }));
  };

  // Unified color: update both stroke and fill colors
  const handleColorChange = (color: string) => {
    setUnifiedColor(color);
    setDefaultStyle((prev) => ({ ...prev, strokeColor: color, fillColor: color }));
    if (selectedIds.length > 0) {
      onShapesChange((prev) =>
        prev.map((s) =>
          selectedIds.includes(s.id)
            ? { ...s, style: { ...s.style, strokeColor: color, fillColor: color } }
            : s
        )
      );
    }
  };

  // Determine toolbar style state (selected shape or defaults)
  const toolbarStyle = (() => {
    const selectedShape = shapes.find((s) => selectedIds.includes(s.id));
    const s = selectedShape ? selectedShape.style : defaultStyle;
    return { strokeWidth: s.strokeWidth, strokeStyle: s.strokeStyle };
  })();

  // Sync unifiedColor when selecting existing shapes
  useEffect(() => {
    const selectedShape = shapes.find((s) => selectedIds.includes(s.id));
    if (selectedShape) {
      setUnifiedColor(selectedShape.style.strokeColor);
    } else {
      setUnifiedColor(defaultStyle.strokeColor);
    }
  }, [selectedIds, shapes, defaultStyle.strokeColor]);

  // Keyboard shortcuts: tool switching, undo/redo, select all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey) {
        const toolMap: Record<string, ToolType> = {
          v: 'select',
          '1': 'select',
          r: 'rectangle',
          '2': 'rectangle',
          o: 'ellipse',
          '3': 'ellipse',
          d: 'rhombus',
          a: 'arrow',
          l: 'line',
          '4': 'line',
          p: 'freehand',
          '5': 'freehand',
          x: 'eraser',
          '7': 'eraser',
        };
        if (toolMap[e.key]) {
          e.preventDefault();
          setActiveTool(toolMap[e.key]);
          return;
        }
      }

      // 'I' for image insert
      if (!e.ctrlKey && !e.metaKey && e.key === 'i') {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (ev) => {
          const file = (ev.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            if (evt.target?.result && typeof evt.target.result === 'string') {
              const img = new Image();
              img.onload = () => {
                const defaultWidth = 200;
                const aspectRatio = img.height / img.width;
                const newShape: ImageShape = {
                  id: Math.random().toString(36).substring(2, 9),
                  type: 'image',
                  x: -panX / scale + 50,
                  y: -panY / scale + 50,
                  width: defaultWidth,
                  height: defaultWidth * aspectRatio,
                  src: evt.target!.result as string,
                  style: { ...defaultStyle },
                };
                setForwardHistory([]);
                setHistory((prev) => [...prev, shapes]);
                onShapesChange([...shapes, newShape]);
                setSelectedIds([newShape.id]);
              };
              img.src = evt.target.result as string;
            }
          };
          reader.readAsDataURL(file);
        };
        input.click();
        return;
      }

      // Ctrl+Y redo
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (forwardHistory.length === 0) return;
        const next = forwardHistory[forwardHistory.length - 1];
        setForwardHistory(forwardHistory.slice(0, -1));
        setHistory([...history, shapes]);
        setShapes(next);
        setSelectedIds([]);
      }

      // Ctrl+A select all
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(shapes.map((s) => s.id));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forwardHistory, history, shapes]);

  // Broadcast cursor position to other users (throttled to ~30fps)
  const broadcastCursor = useCallback((x: number, y: number, isDrawing: boolean) => {
    const now = Date.now();
    if (now - lastCursorBroadcast.current < CURSOR_BROADCAST_THROTTLE) return;
    lastCursorBroadcast.current = now;
    if (wsRef.current?.readyState === WebSocket.OPEN && userIdRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: 'cursor_position',
          userId: userIdRef.current,
          x,
          y,
          color: userColorRef.current,
          name: userName,
          isDrawing,
        })
      );
    }
  }, [userName]);

  // Clear canvas with confirmation
  const clearCanvas = useCallback(() => {
    if (shapes.length === 0) return;
    if (window.confirm('Clear the entire canvas? This cannot be undone.')) {
      setForwardHistory([]);
      // Save current state to history before clearing
      setHistory([...history, shapes]);
      onShapesChange([]);
      setSelectedIds([]);
      // Broadcast all shape deletions
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        for (const shape of shapes) {
          wsRef.current.send(JSON.stringify({ type: 'shape_delete', shapeId: shape.id }));
        }
      }
    }
  }, [shapes, history, onShapesChange]);

  // Insert image from data URL
  const handleImageInsert = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const defaultWidth = 200;
      const aspectRatio = img.height / img.width;
      const newShape: ImageShape = {
        id: Math.random().toString(36).substring(2, 9),
        type: 'image',
        x: -panX / scale + 50,
        y: -panY / scale + 50,
        width: defaultWidth,
        height: defaultWidth * aspectRatio,
        src: dataUrl,
        style: { ...defaultStyle },
      };
      setForwardHistory([]);
      setHistory([...history, shapes]);
      onShapesChange([...shapes, newShape]);
      setSelectedIds([newShape.id]);
    };
    img.src = dataUrl;
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <UnifiedToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onFillStyleChange={handleFillStyleChange}
        onColorChange={handleColorChange}
        unifiedColor={unifiedColor}
        onClearCanvas={clearCanvas}
        onImageInsert={handleImageInsert}
        style={toolbarStyle}
        onStyleChange={handleStyleChange}
        eraserRadius={eraserRadius}
        onEraserRadiusChange={setEraserRadius}
        locked={locked}
        onLockChange={setLocked}
      />
      <CanvasComponent
        activeTool={activeTool}
        shapes={shapes}
        onShapesChange={onShapesChange}
        history={history}
        onHistoryChange={setHistory}
        defaultStyle={defaultStyle}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        userId={userId}
        shapeOwners={shapeOwners}
        remoteCursors={remoteCursors}
        broadcastCursor={broadcastCursor}
        panX={panX}
        panY={panY}
        scale={scale}
        onPanXChange={setPanX}
        onPanYChange={setPanY}
        onScaleChange={setScale}
        eraserRadius={eraserRadius}
        locked={locked}
      />
      <BottomPanel
        roomId={roomId ?? 'unknown'}
        userCount={userCount}
        wsStatus={wsStatus}
        scale={scale}
      />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={'/room/' + generateRoomId()} replace />} />
      <Route path="/room/:roomId" element={<WhiteboardRoom />} />
    </Routes>
  );
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export default App;
