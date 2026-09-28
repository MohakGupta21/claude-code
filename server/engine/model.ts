import type { GameRules, GameStatus } from '../../shared/constants';
import type { MoveResult, PlayerView } from '../../shared/types';

/** Server-side player model. Identical to the public view; secrets live only in the database layer. */
export type Player = PlayerView;

/** Server-side game model that the engine transforms. */
export interface Game {
  id: string;
  roomCode: string;
  status: GameStatus;
  boardId: string;
  rules: GameRules;
  currentPlayerId: string | null;
  winnerId: string | null;
  turnNumber: number;
  round: number;
  lastRoll: MoveResult | null;
  startsAt: string | null;
  createdAt: string;
  updatedAt: string;
  players: Player[];
}
