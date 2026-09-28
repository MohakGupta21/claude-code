import { BOARD_SIZE } from './constants';

/** Maps a start square to a destination square. */
export type JumpMap = Readonly<Record<number, number>>;

export interface BoardConfig {
  id: string;
  name: string;
  size: number;
  snakes: JumpMap;
  ladders: JumpMap;
}

export const CLASSIC_BOARD: BoardConfig = {
  id: 'classic',
  name: 'Classic Jungle',
  size: BOARD_SIZE,
  snakes: {
    17: 7,
    49: 11,
    54: 34,
    62: 19,
    87: 24,
    93: 73,
    95: 75,
    98: 79,
  },
  ladders: {
    4: 14,
    9: 31,
    21: 42,
    28: 84,
    51: 67,
    72: 91,
    80: 99,
  },
};

export const BOARDS: Readonly<Record<string, BoardConfig>> = {
  [CLASSIC_BOARD.id]: CLASSIC_BOARD,
};

export const DEFAULT_BOARD_ID = CLASSIC_BOARD.id;

export function getBoard(id: string): BoardConfig {
  const board = BOARDS[id];
  if (!board) throw new Error(`Unknown board: ${id}`);
  return board;
}

/**
 * Returns a list of problems with a board config (empty when valid).
 * Jumps must stay on the board, snakes go down, ladders go up, and no square may
 * both start a jump and be the destination of another (which would imply chaining).
 */
export function validateBoard(board: BoardConfig): string[] {
  const problems: string[] = [];
  const starts = new Set<number>();
  const ends = new Set<number>();
  const check = (map: JumpMap, kind: 'snake' | 'ladder') => {
    for (const [fromKey, to] of Object.entries(map)) {
      const from = Number(fromKey);
      if (from <= 1 || from >= board.size || to < 1 || to > board.size) {
        problems.push(`${kind} ${from}→${to} is off the board`);
      }
      if (kind === 'snake' && to >= from) problems.push(`snake ${from}→${to} must go down`);
      if (kind === 'ladder' && to <= from) problems.push(`ladder ${from}→${to} must go up`);
      if (starts.has(from)) problems.push(`square ${from} starts more than one jump`);
      starts.add(from);
      ends.add(to);
    }
  };
  check(board.snakes, 'snake');
  check(board.ladders, 'ladder');
  for (const start of starts) {
    if (ends.has(start)) problems.push(`square ${start} is both a jump start and a jump end`);
  }
  return problems;
}
