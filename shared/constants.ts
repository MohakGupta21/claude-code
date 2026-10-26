export const BOARD_SIZE = 100;
export const BOARD_COLUMNS = 10;
export const START_POSITION = 0;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const DICE_MIN = 1;
export const DICE_MAX = 6;

export const PLAYER_NAME_MAX_LENGTH = 16;
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Tokens are assigned in this order. Longer than MAX_PLAYERS so capacity can grow. */
export const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** Number of recent moves included in game state for the activity feed. */
export const RECENT_MOVES_LIMIT = 8;

export const GAME_STATUS = {
  WAITING: 'WAITING',
  STARTING: 'STARTING',
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
  ABANDONED: 'ABANDONED',
} as const;
export type GameStatus = (typeof GAME_STATUS)[keyof typeof GAME_STATUS];

/**
 * How a roll that would overshoot the final square is handled.
 * - exact:     the player must land exactly on the final square, otherwise they stay put.
 * - bounce:    the player bounces back by the excess.
 * - overshoot: any roll that reaches or passes the final square wins.
 */
export type FinishRule = 'exact' | 'bounce' | 'overshoot';

export interface GameRules {
  finishRule: FinishRule;
  /** Dice value that lets the player roll again (unless they won); null disables extra turns. */
  extraTurnOn: number | null;
}

export const DEFAULT_RULES: GameRules = { finishRule: 'exact', extraTurnOn: DICE_MAX };
