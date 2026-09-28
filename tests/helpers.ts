import { randomUUID } from 'node:crypto';
import { DEFAULT_RULES, GAME_STATUS } from '../shared/constants';
import type { Game, Player } from '../server/engine/model';

export const NOW = '2026-01-01T00:00:00.000Z';

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: randomUUID(),
    roomCode: 'ABCDEF',
    status: GAME_STATUS.WAITING,
    boardId: 'classic',
    rules: DEFAULT_RULES,
    currentPlayerId: null,
    winnerId: null,
    turnNumber: 0,
    round: 1,
    lastRoll: null,
    startsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    players: [],
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<Player> & { id: string }): Player {
  return {
    name: overrides.id,
    color: 'red',
    position: 0,
    isHost: false,
    isConnected: true,
    isReady: true,
    turnOrder: 1,
    joinedAt: NOW,
    ...overrides,
  };
}

/** A PLAYING game with players a, b, c (in that turn order), a to move. */
export function playingGame(positions: Record<string, number> = {}): Game {
  const ids = ['a', 'b', 'c'];
  return makeGame({
    status: GAME_STATUS.PLAYING,
    currentPlayerId: 'a',
    turnNumber: 1,
    players: ids.map((id, i) =>
      makePlayer({ id, turnOrder: i + 1, isHost: i === 0, position: positions[id] ?? 0 }),
    ),
  });
}
