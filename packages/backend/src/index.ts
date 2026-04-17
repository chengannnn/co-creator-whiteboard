import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';

// Minimal shape type for backend
interface Shape {
  id: string;
  type: string;
  isDeleted?: boolean;
  [key: string]: unknown;
}

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Room management: roomId -> Set of WebSocket clients
const rooms = new Map<string, Set<WebSocket>>();

// Room shape state: roomId -> Shape[]
const roomShapes = new Map<string, Shape[]>();

// User identity per WebSocket: { color, name }
interface UserIdentity {
  color: string;
  name: string;
}
const userIdentities = new WeakMap<WebSocket, UserIdentity>();

const USER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f43f5e', '#6366f1', '#84cc16',
];

const USER_NAMES = [
  'Fox', 'Owl', 'Bear', 'Wolf', 'Hawk', 'Eagle',
  'Deer', 'Lynx', 'Crane', 'Shark', 'Tiger', 'Panda',
];

function assignUserIdentity(): UserIdentity {
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
  const name = USER_NAMES[Math.floor(Math.random() * USER_NAMES.length)];
  return { color, name };
}

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

function broadcastToRoom(roomId: string, message: object, excludeWs?: WebSocket) {
  const clients = rooms.get(roomId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastCursorLeave(roomId: string, ws: WebSocket) {
  const identity = userIdentities.get(ws);
  if (!identity) return;
  const userId = `${identity.color}-${identity.name}`;
  broadcastToRoom(roomId, { type: 'cursor_leave', userId }, ws);
}

function sendFullState(ws: WebSocket, roomId: string) {
  const allShapes = roomShapes.get(roomId) ?? [];
  // 核心拦截：只下发存活的图形给新用户
  const aliveShapes = allShapes.filter(s => !s.isDeleted);
  ws.send(JSON.stringify({ type: 'sync_state', shapes: aliveShapes }));
}

function scheduleRoomCleanup(roomId: string) {
  // Clear existing timer if any
  const existing = cleanupTimers.get(roomId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    rooms.delete(roomId);
    roomShapes.delete(roomId);
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

  // Assign user identity
  const identity = assignUserIdentity();
  userIdentities.set(ws, identity);

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
    ws.send(JSON.stringify({ type: 'user_identity', color: identity.color, name: identity.name }));

    // Send full canvas state
    sendFullState(ws, queryRoomId);

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
            // 离开旧房间前，先广播清理光标
            broadcastCursorLeave(currentRoom, ws);

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

        // Send user identity
        ws.send(JSON.stringify({ type: 'user_identity', color: identity.color, name: identity.name }));

        // Send current user count to the joining user
        const count = rooms.get(roomId)!.size;
        ws.send(JSON.stringify({ type: 'user_count', count }));

        // Send full canvas state
        sendFullState(ws, roomId);

        // Broadcast updated count to all users in the room
        broadcastUserCount(roomId);

        console.log(`Client joined room ${roomId} (${count} users)`);
      }

      // Shape mutation messages
      if (currentRoom && msg.type === 'shape_create') {
        const shapes = roomShapes.get(currentRoom) ?? [];
        shapes.push(msg.shape);
        roomShapes.set(currentRoom, shapes);
        const identity = userIdentities.get(ws);
        broadcastToRoom(currentRoom, {
          type: 'shape_create',
          shape: msg.shape,
          userId: identity ? `${identity.color}-${identity.name}` : '__unknown__',
        }, ws);
      }

      if (currentRoom && msg.type === 'shape_update') {
        const shapes = roomShapes.get(currentRoom) ?? [];
        const idx = shapes.findIndex((s: Shape) => s.id === msg.shape.id);
        if (idx !== -1) {
          shapes[idx] = msg.shape;
        } else {
          // Upsert: shape not found → add it (critical for Undo restoring elements)
          shapes.push(msg.shape);
        }
        roomShapes.set(currentRoom, shapes);
        broadcastToRoom(currentRoom, msg, ws);
      }

      if (currentRoom && msg.type === 'shape_delete') {
        const shapes = roomShapes.get(currentRoom) ?? [];
        const idx = shapes.findIndex((s: Shape) => s.id === msg.shapeId);
        if (idx !== -1) {
          // Logical delete: mark isDeleted = true instead of physical removal
          shapes[idx] = { ...shapes[idx], isDeleted: true };
          roomShapes.set(currentRoom, shapes);
          broadcastToRoom(currentRoom, msg, ws);
        }
      }

      if (currentRoom && msg.type === 'request_sync') {
        sendFullState(ws, currentRoom);
      }

      // Relay cursor position to room (for live presence)
      if (currentRoom && msg.type === 'cursor_position') {
        const identity = userIdentities.get(ws);
        broadcastToRoom(currentRoom, {
          type: 'cursor_position',
          userId: msg.userId,
          x: msg.x,
          y: msg.y,
          color: identity?.color ?? '#8b5cf6',
          name: identity?.name ?? 'Unknown',
          isDrawing: msg.isDrawing ?? false,
        }, ws);
      }
    } catch {
      console.log('Invalid message:', data.toString());
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      // Broadcast cursor leave before removing from room
      broadcastCursorLeave(currentRoom, ws);

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

// Server-side Garbage Collection (Runs every 10 minutes)
setInterval(() => {
  let totalCleaned = 0;
  for (const [roomId, shapes] of roomShapes.entries()) {
    const aliveShapes = shapes.filter(s => !s.isDeleted);
    if (aliveShapes.length !== shapes.length) {
      totalCleaned += (shapes.length - aliveShapes.length);
      roomShapes.set(roomId, aliveShapes);
    }
  }
  if (totalCleaned > 0) {
    console.log(`[Backend GC] Swept ${totalCleaned} dead shapes from memory.`);
  }
}, 10 * 60 * 1000); // 10 minutes

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
