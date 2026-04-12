import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Toolbar from './components/Toolbar';
import CanvasComponent from './components/CanvasComponent';
import PropertiesPanel from './components/PropertiesPanel';
import RoomHeader from './components/RoomHeader';
import { ToolType, Shape, ShapeStyle, DEFAULT_STYLE } from './types/shapes';

function WhiteboardRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const [activeTool, setActiveTool] = useState<ToolType>('rectangle');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [defaultStyle, setDefaultStyle] = useState<ShapeStyle>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userCount, setUserCount] = useState(1);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket connection for room
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host || 'localhost:3001'}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setWsStatus('connected');

    ws.onopen = () => {
      setWsStatus('connected');
      ws.send(JSON.stringify({ type: 'join_room', roomId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'user_count') {
          setUserCount(msg.count);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setWsStatus('disconnected');
    };

    ws.onerror = () => {
      setWsStatus('disconnected');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [roomId]);

  const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;

  const handleStyleChange = (style: ShapeStyle) => {
    setDefaultStyle(style);
    // Apply style to selected shape
    if (selectedId) {
      setShapes((prev) =>
        prev.map((s) => (s.id === selectedId ? { ...s, style } : s))
      );
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />
      <RoomHeader roomId={roomId ?? 'unknown'} userCount={userCount} wsStatus={wsStatus} />
      <CanvasComponent
        activeTool={activeTool}
        shapes={shapes}
        onShapesChange={setShapes}
        history={history}
        onHistoryChange={setHistory}
        defaultStyle={defaultStyle}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
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
      <Route path="/" element={<Navigate to={`/room/${generateRoomId()}`} replace />} />
      <Route path="/room/:roomId" element={<WhiteboardRoom />} />
    </Routes>
  );
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export default App;
