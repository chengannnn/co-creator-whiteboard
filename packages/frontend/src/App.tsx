import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Toolbar from './components/Toolbar';
import CanvasComponent from './components/CanvasComponent';
import PropertiesPanel from './components/PropertiesPanel';
import { ToolType, Shape, ShapeStyle, DEFAULT_STYLE } from './types/shapes';

function WhiteboardRoom() {
  const [activeTool, setActiveTool] = useState<ToolType>('rectangle');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [defaultStyle, setDefaultStyle] = useState<ShapeStyle>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
