import type { GameEvent, GameState } from './types';

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  GAME_ALREADY_STARTED: 'GAME_ALREADY_STARTED',
  GAME_NOT_ACTIVE: 'GAME_NOT_ACTIVE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  NOT_HOST: 'NOT_HOST',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',
  PLAYERS_NOT_READY: 'PLAYERS_NOT_READY',
  NAME_TAKEN: 'NAME_TAKEN',
  INVALID_PLAYER: 'INVALID_PLAYER',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_MOVE: 'INVALID_MOVE',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Messages sent from the browser. The browser only expresses intent, never outcomes. */
export type ClientMessage =
  | { type: 'join'; playerId: string; token: string }
  | { type: 'reconnect'; playerId: string; token: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'roll_dice' }
  | { type: 'restart' }
  | { type: 'leave' };

export type ClientMessageType = ClientMessage['type'];

export type ServerMessage =
  | { type: 'welcome'; playerId: string; state: GameState }
  | { type: 'state'; state: GameState; events: GameEvent[] }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'left' };

/** Response of POST /api/games and POST /api/games/:roomCode/join */
export interface SessionResponse {
  roomCode: string;
  playerId: string;
  token: string;
  state: GameState;
}

export interface ErrorResponse {
  error: { code: ErrorCode; message: string };
}
