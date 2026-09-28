import type { IncomingMessage, ServerResponse } from 'node:http';
import { ERROR_CODES, type ErrorResponse } from '../../shared/protocol';
import { GameError, Errors } from '../errors';
import type { GameService } from '../game/gameService';
import type { RoomManager } from '../game/roomManager';
import { logger } from '../logger';
import { RateLimiter } from '../rateLimiter';
import { parsePlayerName, parseRoomCode } from '../validation';

const MAX_BODY_BYTES = 2 * 1024;
const ROOM_ROUTE = /^\/api\/games\/([^/]+)$/;
const JOIN_ROUTE = /^\/api\/games\/([^/]+)\/join$/;

export interface ApiDeps {
  service: GameService;
  rooms: RoomManager;
}

/**
 * REST endpoints for things that happen before a socket exists: creating, joining and peeking at
 * a room. Everything else happens over the room's WebSocket. Returns false if the path is not an API route.
 */
export function createApiHandler({ service, rooms }: ApiDeps) {
  const writeLimiter = new RateLimiter(30, 60_000);

  return async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return false;

    try {
      if (req.method === 'POST' && !writeLimiter.allow(req.socket.remoteAddress ?? 'unknown')) {
        throw Errors.rateLimited();
      }

      if (path === '/api/health' && req.method === 'GET') {
        return json(res, 200, { ok: true });
      }

      if (path === '/api/games' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, 201, await service.createGame(parsePlayerName(body.name)));
      }

      const join = JOIN_ROUTE.exec(path);
      if (join && req.method === 'POST') {
        const roomCode = parseRoomCode(decodeURIComponent(join[1]));
        const body = await readJson(req);
        return json(res, 201, await rooms.join(roomCode, parsePlayerName(body.name)));
      }

      const room = ROOM_ROUTE.exec(path);
      if (room && req.method === 'GET') {
        return json(res, 200, { state: await service.getState(parseRoomCode(decodeURIComponent(room[1]))) });
      }

      return json(res, 404, errorBody(ERROR_CODES.INVALID_INPUT, 'Not found.'));
    } catch (error) {
      if (error instanceof GameError) return json(res, statusFor(error), errorBody(error.code, error.message));
      logger.error(`API error on ${req.method} ${path}`, error);
      return json(res, 500, errorBody(ERROR_CODES.INTERNAL, 'Something went wrong. Please try again.'));
    }
  };
}

function statusFor(error: GameError): number {
  switch (error.code) {
    case ERROR_CODES.ROOM_NOT_FOUND:
      return 404;
    case ERROR_CODES.ROOM_FULL:
    case ERROR_CODES.GAME_ALREADY_STARTED:
    case ERROR_CODES.NAME_TAKEN:
      return 409;
    case ERROR_CODES.RATE_LIMITED:
      return 429;
    case ERROR_CODES.NOT_AUTHENTICATED:
      return 401;
    default:
      return 400;
  }
}

function errorBody(code: ErrorResponse['error']['code'], message: string): ErrorResponse {
  return { error: { code, message } };
}

function json(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Errors.invalidInput('Request is too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw Errors.invalidInput('Invalid request body.');
}
