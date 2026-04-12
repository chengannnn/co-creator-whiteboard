import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Toolbar from './components/Toolbar';
import CanvasComponent from './components/CanvasComponent';
import { ToolType, Shape } from './types/shapes';

function WhiteboardRoom() {
  const [activeTool, setActiveTool] = useState<ToolType>('rectangle');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />
      <CanvasComponent
        activeTool={activeTool}
        shapes={shapes}
        onShapesChange={setShapes}
        history={history}
        onHistoryChange={setHistory}
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
