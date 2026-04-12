import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Toolbar from './components/Toolbar';
import CanvasComponent from './components/CanvasComponent';
import PropertiesPanel from './components/PropertiesPanel';
import RoomHeader from './components/RoomHeader';
import { ToolType, Shape, ShapeStyle, DEFAULT_STYLE } from './types/shapes';

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
  const [defaultStyle, setDefaultStyle] = useState<ShapeStyle>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
            setSelectedId(null);
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
            setSelectedId((prev) => (prev === msg.shapeId ? null : prev));
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

  const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;

  const handleStyleChange = (style: ShapeStyle) => {
    setDefaultStyle(style);
    if (selectedId) {
      onShapesChange((prev) =>
        prev.map((s) => (s.id === selectedId ? { ...s, style } : s))
      );
    }
  };

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

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />
      <RoomHeader roomId={roomId ?? 'unknown'} userCount={userCount} wsStatus={wsStatus} />
      <CanvasComponent
        activeTool={activeTool}
        shapes={shapes}
        onShapesChange={onShapesChange}
        history={history}
        onHistoryChange={setHistory}
        defaultStyle={defaultStyle}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
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
      />
      <PropertiesPanel
        selectedShape={selectedShape}
        onStyleChange={handleStyleChange}
        defaultStyle={defaultStyle}
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
