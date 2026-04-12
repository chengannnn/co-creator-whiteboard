import { Routes, Route, Navigate } from 'react-router-dom';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/room/${generateRoomId()}`} replace />} />
      <Route path="/room/:roomId" element={<div>Whiteboard Room</div>} />
    </Routes>
  );
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export default App;
