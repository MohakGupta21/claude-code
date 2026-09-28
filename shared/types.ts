import type { BoardConfig } from './boards';
import type { GameRules, GameStatus, PlayerColor } from './constants';

export interface PlayerView {
  id: string;
  name: string;
  color: PlayerColor;
  position: number;
  isHost: boolean;
  isConnected: boolean;
  isReady: boolean;
  turnOrder: number;
  joinedAt: string;
}

export type JumpKind = 'snake' | 'ladder';

/** Outcome of a single dice roll, computed by the server's game engine. */
export interface MoveResult {
  playerId: string;
  diceValue: number;
  startPosition: number;
  /** Square reached by the dice alone (before any snake or ladder). */
  endPosition: number;
  /** Square after applying a snake or ladder. */
  finalPosition: number;
  jump: JumpKind | null;
  /** True when the roll could not be used (e.g. overshooting with exact-finish rules). */
  blocked: boolean;
  /** True when the dice overshot and the token bounced back (bounce rule). */
  bounced: boolean;
  won: boolean;
  turnNumber: number;
}

export interface MoveLogEntry extends MoveResult {
  id: number;
  createdAt: string;
}

export interface GameState {
  gameId: string;
  roomCode: string;
  status: GameStatus;
  players: PlayerView[];
  currentPlayerId: string | null;
  winnerId: string | null;
  board: BoardConfig;
  rules: GameRules;
  lastDiceRoll: MoveResult | null;
  turnNumber: number;
  round: number;
  /** ISO time at which a STARTING game begins play. */
  startsAt: string | null;
  recentMoves: MoveLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export type GameEvent =
  | { type: 'PLAYER_JOINED'; playerId: string; name: string }
  | { type: 'PLAYER_LEFT'; playerId: string; name: string }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string; name: string }
  | { type: 'PLAYER_RECONNECTED'; playerId: string; name: string }
  | { type: 'PLAYER_READY'; playerId: string; ready: boolean }
  | { type: 'HOST_CHANGED'; playerId: string; name: string }
  | { type: 'GAME_STARTING'; startsAt: string }
  | { type: 'GAME_STARTED' }
  | { type: 'DICE_ROLLED'; move: MoveResult }
  | { type: 'PLAYER_MOVED'; playerId: string; from: number; to: number }
  | { type: 'SNAKE_TRIGGERED'; playerId: string; from: number; to: number }
  | { type: 'LADDER_TRIGGERED'; playerId: string; from: number; to: number }
  | { type: 'TURN_SKIPPED'; playerId: string; name: string }
  | { type: 'TURN_CHANGED'; playerId: string; turnNumber: number }
  | { type: 'GAME_WON'; playerId: string; name: string }
  | { type: 'GAME_ABANDONED' }
  | { type: 'GAME_RESTARTED'; round: number };

export type GameEventType = GameEvent['type'];
