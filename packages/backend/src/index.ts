import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Room management: roomId -> Set of WebSocket clients
const rooms = new Map<string, Set<WebSocket>>();

// Track cleanup timers per room
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

const ROOM_CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// Room API endpoints
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const clients = rooms.get(roomId);
  res.json({ roomId, userCount: clients?.size ?? 0 });
});

function broadcastUserCount(roomId: string) {
  const clients = rooms.get(roomId);
  if (!clients) return;
  const count = clients.size;
  const message = JSON.stringify({ type: 'user_count', count });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function scheduleRoomCleanup(roomId: string) {
  // Clear existing timer if any
  const existing = cleanupTimers.get(roomId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    rooms.delete(roomId);
    cleanupTimers.delete(roomId);
    console.log(`Room ${roomId} cleaned up after inactivity`);
  }, ROOM_CLEANUP_DELAY_MS);

  cleanupTimers.set(roomId, timer);
}

function cancelRoomCleanup(roomId: string) {
  const timer = cleanupTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(roomId);
  }
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  let currentRoom: string | null = null;

  // Support roomId from query string (preferred)
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const queryRoomId = url.searchParams.get('roomId');

  if (queryRoomId) {
    currentRoom = queryRoomId;
    if (!rooms.has(queryRoomId)) {
      rooms.set(queryRoomId, new Set());
      cancelRoomCleanup(queryRoomId);
    }
    rooms.get(queryRoomId)!.add(ws);

    const count = rooms.get(queryRoomId)!.size;
    ws.send(JSON.stringify({ type: 'user_count', count }));
    broadcastUserCount(queryRoomId);
    console.log(`Client joined room ${queryRoomId} via URL (${count} users)`);
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'join_room' && msg.roomId) {
        const roomId = msg.roomId;

        // Leave previous room if any
        if (currentRoom) {
          const prevClients = rooms.get(currentRoom);
          if (prevClients) {
            prevClients.delete(ws);
            if (prevClients.size === 0) {
              rooms.delete(currentRoom);
              scheduleRoomCleanup(currentRoom);
            } else {
              broadcastUserCount(currentRoom);
            }
          }
        }

        // Join new room
        currentRoom = roomId;
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
          cancelRoomCleanup(roomId);
        }
        rooms.get(roomId)!.add(ws);

        // Send current user count to the joining user
        const count = rooms.get(roomId)!.size;
        ws.send(JSON.stringify({ type: 'user_count', count }));

        // Broadcast updated count to all users in the room
        broadcastUserCount(roomId);

        console.log(`Client joined room ${roomId} (${count} users)`);
      }
    } catch {
      console.log('Invalid message:', data.toString());
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const clients = rooms.get(currentRoom);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          rooms.delete(currentRoom);
          scheduleRoomCleanup(currentRoom);
        } else {
          broadcastUserCount(currentRoom);
        }
      }
      console.log(`Client left room ${currentRoom} (${clients?.size ?? 0} users remaining)`);
    } else {
      console.log('Client disconnected (no room)');
    }
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
