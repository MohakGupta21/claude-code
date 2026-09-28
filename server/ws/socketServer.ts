import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { ERROR_CODES } from '../../shared/protocol';
import { GameError, Errors } from '../errors';
import type { GameService } from '../game/gameService';
import type { RoomManager } from '../game/roomManager';
import { logger } from '../logger';
import { RateLimiter } from '../rateLimiter';
import { isRoomCode, parseClientMessage } from '../validation';
import { CLOSE_LEFT, type ConnectionRegistry, send } from './connectionRegistry';

const WS_PATH = /^\/ws\/games\/([A-Za-z0-9]+)\/?$/;
const MAX_MESSAGE_BYTES = 4 * 1024;
const AUTH_TIMEOUT_MS = 10_000;
const MESSAGES_PER_SECOND = 10;

interface Connection {
  roomCode: string;
  playerId: string | null;
  alive: boolean;
  id: number;
}

export interface SocketServerDeps {
  server: Server;
  service: GameService;
  rooms: RoomManager;
  registry: ConnectionRegistry;
  heartbeatMs: number;
}

/** WebSocket endpoint at /ws/games/:roomCode. The first message must authenticate the player. */
export function attachSocketServer({ server, service, rooms, registry, heartbeatMs }: SocketServerDeps) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const limiter = new RateLimiter(MESSAGES_PER_SECOND, 1000);
  const connections = new Map<WebSocket, Connection>();
  let nextId = 1;

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = WS_PATH.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    const roomCode = match?.[1].toUpperCase();
    if (!roomCode || !isRoomCode(roomCode)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, roomCode));
  });

  function onConnection(ws: WebSocket, roomCode: string): void {
    const conn: Connection = { roomCode, playerId: null, alive: true, id: nextId++ };
    connections.set(ws, conn);
    const authTimer = setTimeout(() => {
      if (!conn.playerId) ws.close(1008, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return reportError(ws, Errors.invalidInput('Malformed message.'));
      if (!limiter.allow(String(conn.id))) return reportError(ws, Errors.rateLimited());
      try {
        handleMessage(ws, conn, data.toString());
      } catch (error) {
        reportError(ws, error);
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      connections.delete(ws);
      if (conn.playerId && registry.unregister(conn.roomCode, conn.playerId, ws)) {
        try {
          rooms.disconnect(conn.roomCode, conn.playerId);
        } catch (error) {
          if (!(error instanceof GameError)) logger.error('Failed to handle disconnect', error);
        }
      }
    });
    ws.on('error', (error) => logger.warn('WebSocket error', error.message));
  }

  function handleMessage(ws: WebSocket, conn: Connection, raw: string): void {
    const message = parseClientMessage(raw);

    if (message.type === 'join' || message.type === 'reconnect') {
      service.authenticate(conn.roomCode, message.playerId, message.token);
      if (conn.playerId && conn.playerId !== message.playerId) throw Errors.invalidPlayer();
      conn.playerId = message.playerId;
      registry.register(conn.roomCode, message.playerId, ws);
      const state = rooms.connect(conn.roomCode, message.playerId);
      send(ws, { type: 'welcome', playerId: message.playerId, state });
      return;
    }

    if (!conn.playerId) throw Errors.notAuthenticated();
    const playerId = conn.playerId;
    rooms.handleAction(conn.roomCode, playerId, message);

    if (message.type === 'leave') {
      registry.unregister(conn.roomCode, playerId, ws);
      conn.playerId = null;
      send(ws, { type: 'left' });
      ws.close(CLOSE_LEFT, 'Left the game');
    }
  }

  function reportError(ws: WebSocket, error: unknown): void {
    if (error instanceof GameError) {
      send(ws, { type: 'error', code: error.code, message: error.message });
      return;
    }
    logger.error('Unhandled WebSocket error', error);
    send(ws, { type: 'error', code: ERROR_CODES.INTERNAL, message: 'Something went wrong. Please try again.' });
  }

  // Terminate sockets that stop answering pings so disconnects are detected promptly.
  const heartbeat = setInterval(() => {
    for (const [ws, conn] of connections) {
      if (!conn.alive) {
        ws.terminate();
        continue;
      }
      conn.alive = false;
      ws.ping();
    }
  }, heartbeatMs);

  return {
    close() {
      clearInterval(heartbeat);
      registry.closeAll();
      wss.close();
    },
  };
}
