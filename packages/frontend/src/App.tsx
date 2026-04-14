import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import BottomPanel from './components/BottomPanel';
import UnifiedToolbar from './components/UnifiedToolbar';
import CanvasComponent, { CanvasComponentRef } from './components/CanvasComponent';
import { Scene } from './core/Scene';
import { HistoryManager } from './core/HistoryManager';
import type { SceneElement, StrokeWidth, StrokeStyle, FillStyle, ToolType } from './types/element';
import { DEFAULT_STYLE } from './types/element';
import { ThemeMode } from './theme';

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
  const [defaultStyle, setDefaultStyle] = useState({
    strokeColor: DEFAULT_STYLE.strokeColor,
    strokeWidth: DEFAULT_STYLE.strokeWidth,
    strokeStyle: DEFAULT_STYLE.strokeStyle,
    fillStyle: DEFAULT_STYLE.fillStyle,
    fillColor: DEFAULT_STYLE.fillColor,
  });
  const [unifiedColor, setUnifiedColor] = useState<string>(DEFAULT_STYLE.strokeColor);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [userCount, setUserCount] = useState(1);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  // User identity (assigned by server)
  const [userId, setUserId] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<string>('#3b82f6');
  const [userName, setUserName] = useState<string>('');

  // Shape ownership: elementId -> userId
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

  // Theme (light/dark, not persisted, defaults to light)
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  // Scene and history (refs to avoid re-renders on every mutation)
  const sceneRef = useRef<Scene>(new Scene());
  const historyRef = useRef<HistoryManager>(new HistoryManager(sceneRef.current));

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<CanvasComponentRef>(null);
  const userIdRef = useRef<string | null>(null);
  const userColorRef = useRef<string>('#3b82f6');
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    userColorRef.current = userColor;
  }, [userColor]);

  // Send scene mutation over WebSocket
  const sendSceneMutation = useCallback((type: string, data: { element?: SceneElement; elementId?: string; userId?: string }) => {
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
            // Convert legacy Shape[] to SceneElement[] for initial sync
            // (server still sends Shape format, we convert client-side)
            const scene = sceneRef.current;
            scene.replaceAll(msg.shapes.map(shapeToElement));
            historyRef.current.clear();
            setSelectedIds([]);
            const owners = new Map<string, string>();
            for (const s of msg.shapes) {
              owners.set(s.id, '__remote__');
            }
            setShapeOwners(owners);
            setRemoteCursors(new Map());
          } else if (msg.type === 'shape_create' && msg.shape) {
            const scene = sceneRef.current;
            const el = shapeToElement(msg.shape);
            scene.addElement(el);
            setShapeOwners((prev) => {
              const next = new Map(prev);
              next.set(el.id, msg.userId ?? '__unknown__');
              return next;
            });
          } else if (msg.type === 'shape_update' && msg.shape) {
            const scene = sceneRef.current;
            const el = shapeToElement(msg.shape);
            scene.updateElement(el.id, el as Partial<SceneElement>);
          } else if (msg.type === 'shape_delete' && msg.shapeId) {
            const scene = sceneRef.current;
            scene.deleteElement(msg.shapeId);
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

  // Called after each committed scene mutation from CanvasComponent.
  // Triggers history push and WebSocket broadcast.
  const onSceneMutate = useCallback((action: 'add' | 'update' | 'delete' | 'replaceAll' | 'clear') => {
    const scene = sceneRef.current;
    const elements = scene.getElements();

    if (action === 'add') {
      // The most recently added element
      historyRef.current.push();
      const lastEl = elements[elements.length - 1];
      if (lastEl) {
        sendSceneMutation('shape_create', { element: lastEl, userId: userIdRef.current ?? '__local__' });
        setShapeOwners((prev) => {
          const next = new Map(prev);
          next.set(lastEl.id, userIdRef.current ?? '__local__');
          return next;
        });
      }
    } else if (action === 'update') {
      historyRef.current.push();
      // Broadcast all updated elements
      for (const el of elements) {
        sendSceneMutation('shape_update', { element: el });
      }
    } else if (action === 'delete') {
      historyRef.current.push();
      // Broadcast deleted elements
      const deletedElements = scene.snapshot().filter((el) => el.isDeleted);
      for (const el of deletedElements) {
        sendSceneMutation('shape_delete', { elementId: el.id });
        setShapeOwners((prev) => {
          const next = new Map(prev);
          next.delete(el.id);
          return next;
        });
      }
    } else if (action === 'replaceAll') {
      // undo/redo — no history push (already handled by HistoryManager)
      // Broadcast full diff: check which elements were added/removed/modified
      // For simplicity, broadcast all elements as updates
      for (const el of elements) {
        sendSceneMutation('shape_update', { element: el });
      }
    } else if (action === 'clear') {
      historyRef.current.push();
      // Broadcast all deletions
      const deletedElements = scene.snapshot().filter((el) => el.isDeleted);
      for (const el of deletedElements) {
        sendSceneMutation('shape_delete', { elementId: el.id });
        setShapeOwners((prev) => {
          const next = new Map(prev);
          next.delete(el.id);
          return next;
        });
      }
    }
  }, [sendSceneMutation]);

  // Called to apply intermediate move/resize results
  const onMoveElements = useCallback((elements: SceneElement[]) => {
    // Replace all elements in scene with the moved/resized versions
    const scene = sceneRef.current;
    scene.replaceAll(elements);
  }, []);

  // Unified toolbar: update style defaults
  const handleStyleChange = (patch: { strokeWidth?: StrokeWidth; strokeStyle?: StrokeStyle }) => {
    setDefaultStyle((prev) => ({ ...prev, ...patch }));
  };

  // Toolbar: set fillStyle when clicking outline/solid shape buttons
  const handleFillStyleChange = (fill: FillStyle) => {
    setDefaultStyle((prev) => ({ ...prev, fillStyle: fill }));
  };

  // Unified color: update both stroke and fill colors
  const handleColorChange = (color: string) => {
    setUnifiedColor(color);
    setDefaultStyle((prev) => ({ ...prev, strokeColor: color, fillColor: color }));
  };

  // Determine toolbar style state
  const toolbarStyle = (() => {
    return { strokeWidth: defaultStyle.strokeWidth, strokeStyle: defaultStyle.strokeStyle };
  })();

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
                const now = Date.now();
                const newEl: SceneElement = {
                  id: Math.random().toString(36).substring(2, 9),
                  type: 'image',
                  x: -panX / scale + 50,
                  y: -panY / scale + 50,
                  width: defaultWidth,
                  height: defaultWidth * aspectRatio,
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
                  updated: now,
                  ownerId: userId ?? '',
                  seed: Math.floor(Math.random() * 1e9),
                  src: evt.target!.result as string,
                  fileId: null,
                };
                sceneRef.current.addElement(newEl);
                historyRef.current.push();
                onSceneMutate('add');
                setSelectedIds([newEl.id]);
              };
              img.src = evt.target.result as string;
            }
          };
          reader.readAsDataURL(file);
        };
        input.click();
        return;
      }

      // Ctrl+Y redo (CanvasComponent handles this via ref)
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        canvasRef.current?.redo();
      }

      // Ctrl+A select all
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(sceneRef.current.getElements().map((el) => el.id));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panX, panY, scale, defaultStyle, userId]);

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

  // Clear canvas (pushes current state to history, then deletes all)
  const insertImage = useCallback((dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const defaultWidth = 200;
      const aspectRatio = img.height / img.width;
      const now = Date.now();
      const newEl: SceneElement = {
        id: Math.random().toString(36).substring(2, 9),
        type: 'image',
        x: -panX / scale + 50,
        y: -panY / scale + 50,
        width: defaultWidth,
        height: defaultWidth * aspectRatio,
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
        updated: now,
        ownerId: userId ?? '',
        seed: Math.floor(Math.random() * 1e9),
        src: dataUrl,
        fileId: null,
      };
      sceneRef.current.addElement(newEl);
      historyRef.current.push();
      onSceneMutate('add');
      setSelectedIds([newEl.id]);
    };
    img.src = dataUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panX, panY, scale, defaultStyle, userId, onSceneMutate]);

  // Clear canvas (pushes current state to history, then deletes all)
  const clearCanvas = useCallback(() => {
    const scene = sceneRef.current;
    const elements = scene.getElements();
    if (elements.length === 0) return;
    historyRef.current.push();
    for (const el of elements) {
      scene.deleteElement(el.id);
    }
    onSceneMutate('clear');
    setSelectedIds([]);
  }, [onSceneMutate]);

  // Export canvas as PNG
  const handleExportPng = useCallback(() => {
    canvasRef.current?.exportPng();
  }, []);

  // Undo/redo via canvas ref
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
  }, []);

  // Unified zoom control
  const setZoom = useCallback((newZoom: number) => {
    setScale((prev) => {
      const clamped = Math.min(5, Math.max(0.1, newZoom));
      const scaleRatio = clamped / prev;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setPanX((px) => cx - (cx - px) * scaleRatio);
      setPanY((py) => cy - (cy - py) * scaleRatio);
      return clamped;
    });
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <UnifiedToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onFillStyleChange={handleFillStyleChange}
        onColorChange={handleColorChange}
        unifiedColor={unifiedColor}
        onClearCanvas={clearCanvas}
        onImageInsert={insertImage}
        style={toolbarStyle}
        onStyleChange={handleStyleChange}
        eraserRadius={eraserRadius}
        onEraserRadiusChange={setEraserRadius}
        locked={locked}
        onLockChange={setLocked}
        onSave={handleExportPng}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
      />
      <CanvasComponent
        ref={canvasRef}
        scene={sceneRef.current}
        history={historyRef.current}
        activeTool={activeTool}
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
        themeMode={themeMode}
        onSceneMutate={onSceneMutate}
        onMoveElements={onMoveElements}
      />
      <BottomPanel
        roomId={roomId ?? 'unknown'}
        userCount={userCount}
        wsStatus={wsStatus}
        scale={scale}
        themeMode={themeMode}
        onZoom={setZoom}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyRef.current.canUndo()}
        canRedo={historyRef.current.canRedo()}
      />
    </div>
  );
}

/**
 * Convert a legacy Shape object (from server sync) to SceneElement format.
 * Used only for initial sync_state from server which still uses Shape format.
 */
function shapeToElement(shape: {
  id: string;
  type: string;
  x?: number; y?: number;
  width?: number; height?: number;
  startX?: number; startY?: number;
  endX?: number; endY?: number;
  points?: { x: number; y: number }[];
  content?: string; fontSize?: number;
  src?: string;
  style?: {
    strokeColor: string;
    strokeWidth: number;
    strokeStyle: string;
    fillStyle: string;
    fillColor: string;
  };
  ownerId?: string;
}): SceneElement {
  const style = shape.style ?? DEFAULT_STYLE;
  const now = Date.now();

  const commonBase = {
    id: shape.id,
    angle: 0,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth as StrokeWidth,
    strokeStyle: style.strokeStyle as StrokeStyle,
    fillStyle: style.fillStyle as FillStyle,
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
      return { ...commonBase, type: 'rectangle', x: shape.x ?? 0, y: shape.y ?? 0, width: shape.width ?? 0, height: shape.height ?? 0 };
    case 'ellipse':
      return { ...commonBase, type: 'ellipse', x: shape.x ?? 0, y: shape.y ?? 0, width: shape.width ?? 0, height: shape.height ?? 0 };
    case 'rhombus':
      return { ...commonBase, type: 'rhombus', x: shape.x ?? 0, y: shape.y ?? 0, width: shape.width ?? 0, height: shape.height ?? 0 };
    case 'freehand': {
      const xs = shape.points?.map((p) => p.x) ?? [];
      const ys = shape.points?.map((p) => p.y) ?? [];
      return {
        ...commonBase,
        type: 'freehand',
        x: xs.length ? Math.min(...xs) : 0,
        y: ys.length ? Math.min(...ys) : 0,
        width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
        height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
        points: shape.points ?? [],
      };
    }
    case 'line':
      return {
        ...commonBase,
        type: 'line',
        x: shape.startX ?? 0,
        y: shape.startY ?? 0,
        width: Math.abs((shape.endX ?? 0) - (shape.startX ?? 0)),
        height: Math.abs((shape.endY ?? 0) - (shape.startY ?? 0)),
        points: [
          { x: 0, y: 0 },
          { x: (shape.endX ?? 0) - (shape.startX ?? 0), y: (shape.endY ?? 0) - (shape.startY ?? 0) },
        ],
        startArrowhead: null,
        endArrowhead: null,
      };
    case 'arrow':
      return {
        ...commonBase,
        type: 'arrow',
        x: shape.startX ?? 0,
        y: shape.startY ?? 0,
        width: Math.abs((shape.endX ?? 0) - (shape.startX ?? 0)),
        height: Math.abs((shape.endY ?? 0) - (shape.startY ?? 0)),
        points: [
          { x: 0, y: 0 },
          { x: (shape.endX ?? 0) - (shape.startX ?? 0), y: (shape.endY ?? 0) - (shape.startY ?? 0) },
        ],
        startArrowhead: null,
        endArrowhead: 'arrow',
      };
    case 'text':
      return {
        ...commonBase,
        type: 'text',
        x: shape.x ?? 0,
        y: shape.y ?? 0,
        width: shape.width ?? 0,
        height: shape.height ?? 0,
        content: shape.content ?? '',
        fontSize: shape.fontSize ?? 20,
        fontFamily: 'sans-serif',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.25,
      };
    case 'image':
      return {
        ...commonBase,
        type: 'image',
        x: shape.x ?? 0,
        y: shape.y ?? 0,
        width: shape.width ?? 0,
        height: shape.height ?? 0,
        src: shape.src ?? '',
        fileId: null,
      };
    default:
      throw new Error(`Unknown shape type: ${shape.type}`);
  }
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
