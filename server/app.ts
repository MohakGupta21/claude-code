import { createServer, type Server } from 'node:http';
import { openDatabase, type Database } from './db/database';
import { GameRepository } from './db/gameRepository';
import { GameService } from './game/gameService';
import { RoomManager } from './game/roomManager';
import { createApiHandler } from './http/api';
import { createStaticHandler } from './http/staticFiles';
import { logger } from './logger';
import { ConnectionRegistry } from './ws/connectionRegistry';
import { attachSocketServer } from './ws/socketServer';
import type { ServerConfig } from './config';

export interface App {
  server: Server;
  db: Database;
  service: GameService;
  close(): Promise<void>;
}

/** Wires the database, services, HTTP API, static client and WebSocket server together. */
export function createApp(config: ServerConfig): App {
  const db = openDatabase(config.dbPath);
  const repo = new GameRepository(db);
  repo.markAllDisconnected();

  const registry = new ConnectionRegistry();
  const service = new GameService(repo, { startCountdownMs: config.startCountdownMs });
  const rooms = new RoomManager(service, (roomCode, message) => registry.broadcast(roomCode, message), {
    reconnectGraceMs: config.reconnectGraceMs,
  });
  rooms.resume();

  const handleApi = createApiHandler({ service, rooms });
  const serveStatic = createStaticHandler(config.clientDir);

  const server = createServer((req, res) => {
    handleApi(req, res)
      .then((handled) => {
        if (!handled) serveStatic(req, res);
      })
      .catch((error) => {
        logger.error('Unhandled HTTP error', error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });

  const sockets = attachSocketServer({ server, service, rooms, registry, heartbeatMs: config.heartbeatMs });

  return {
    server,
    db,
    service,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.close();
        rooms.shutdown();
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
