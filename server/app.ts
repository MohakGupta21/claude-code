import { createServer, type Server } from 'node:http';
import { openDatabase, type Database } from './db/database';
import { GameRepository } from './db/gameRepository';
import { GameService, type GameServiceOptions } from './game/gameService';
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
export async function createApp(
  config: ServerConfig,
  serviceOptions: Pick<GameServiceOptions, 'rollDice'> = {},
): Promise<App> {
  const db = await openDatabase({ connectionString: config.databaseUrl, maxConnections: config.databasePoolMax });
  const repo = GameRepository.forPool(db);
  await repo.markAllDisconnected();

  const registry = new ConnectionRegistry();
  const service = new GameService(repo, { ...serviceOptions, startCountdownMs: config.startCountdownMs });
  const rooms = new RoomManager(service, (roomCode, message) => registry.broadcast(roomCode, message), {
    reconnectGraceMs: config.reconnectGraceMs,
  });
  await rooms.resume();

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
    async close() {
      sockets.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
      await rooms.shutdown();
      await db.end();
    },
  };
}
