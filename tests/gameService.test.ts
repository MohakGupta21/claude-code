import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAME_STATUS, MAX_PLAYERS } from '../shared/constants';
import { openDatabase, type Database } from '../server/db/database';
import { GameRepository } from '../server/db/gameRepository';
import { GameService } from '../server/game/gameService';
import { GameError } from '../server/errors';

let dir: string;
let dbPath: string;
let db: Database;
let service: GameService;
let nextRoll: number[];

function open() {
  db = openDatabase(dbPath);
  service = new GameService(new GameRepository(db), {
    startCountdownMs: 0,
    rollDice: () => nextRoll.shift() ?? 1,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'snl-test-'));
  dbPath = join(dir, 'test.db');
  nextRoll = [];
  open();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function errorCode(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof GameError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

/** Creates a room with two players and starts play. */
function startedTwoPlayerGame() {
  const host = service.createGame('Mohak');
  const { session: guest } = service.joinGame(host.roomCode, 'Rahul');
  service.setReady(host.roomCode, guest.playerId, true);
  service.startGame(host.roomCode, host.playerId);
  service.beginPlay(host.roomCode);
  return { roomCode: host.roomCode, host, guest };
}

describe('GameService', () => {
  it('creates a room with the creator as host', () => {
    const session = service.createGame('Mohak');
    expect(session.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(session.token).toMatch(/^[0-9a-f]{64}$/);
    expect(session.state.status).toBe(GAME_STATUS.WAITING);
    expect(session.state.players).toMatchObject([{ id: session.playerId, name: 'Mohak', isHost: true }]);
  });

  it('lets multiple players join and enforces capacity', async () => {
    const host = service.createGame('P1');
    for (let i = 2; i <= MAX_PLAYERS; i++) service.joinGame(host.roomCode, `P${i}`);
    expect(service.getState(host.roomCode).players).toHaveLength(MAX_PLAYERS);
    expect(await errorCode(() => service.joinGame(host.roomCode, 'Extra'))).toBe('ROOM_FULL');
  });

  it('rejects joining unknown rooms and rooms that already started', async () => {
    expect(await errorCode(() => service.joinGame('ZZZZZZ', 'Nobody'))).toBe('ROOM_NOT_FOUND');
    const { roomCode } = startedTwoPlayerGame();
    expect(await errorCode(() => service.joinGame(roomCode, 'Late'))).toBe('GAME_ALREADY_STARTED');
  });

  it('authenticates players by their secret token only', async () => {
    const host = service.createGame('Mohak');
    const other = service.createGame('Amit');
    expect(() => service.authenticate(host.roomCode, host.playerId, host.token)).not.toThrow();
    expect(await errorCode(() => service.authenticate(host.roomCode, host.playerId, other.token))).toBe('NOT_AUTHENTICATED');
    expect(await errorCode(() => service.authenticate(host.roomCode, other.playerId, other.token))).toBe('NOT_AUTHENTICATED');
  });

  it('generates dice server-side, persists the move and passes the turn', async () => {
    const { roomCode, host, guest } = startedTwoPlayerGame();
    nextRoll = [3];
    expect(await errorCode(() => service.rollDice(roomCode, guest.playerId))).toBe('NOT_YOUR_TURN');

    const { state, events } = service.rollDice(roomCode, host.playerId);
    expect(state.lastDiceRoll).toMatchObject({ playerId: host.playerId, diceValue: 3, finalPosition: 3 });
    expect(state.currentPlayerId).toBe(guest.playerId);
    expect(state.turnNumber).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['DICE_ROLLED', 'PLAYER_MOVED', 'TURN_CHANGED']);

    const moves = db.prepare('SELECT * FROM moves').all() as Record<string, unknown>[];
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ dice_value: 3, start_position: 0, end_position: 3, final_position: 3 });
  });

  it('applies ladders and records both landing and final squares', () => {
    const { roomCode, host } = startedTwoPlayerGame();
    nextRoll = [4]; // 0 → 4, classic ladder 4 → 14
    const { state, events } = service.rollDice(roomCode, host.playerId);
    expect(state.players.find((p) => p.id === host.playerId)!.position).toBe(14);
    expect(events).toContainEqual({ type: 'LADDER_TRIGGERED', playerId: host.playerId, from: 4, to: 14 });
    expect(state.recentMoves[0]).toMatchObject({ endPosition: 4, finalPosition: 14, jump: 'ladder' });
  });

  it('persists game state across a restart and preserves reconnecting players', () => {
    const { roomCode, host, guest } = startedTwoPlayerGame();
    service.setConnected(roomCode, host.playerId, true);
    service.setConnected(roomCode, guest.playerId, true);
    nextRoll = [5, 2];
    service.rollDice(roomCode, host.playerId);
    service.rollDice(roomCode, guest.playerId);
    service.setConnected(roomCode, guest.playerId, false);

    // Simulate a process restart.
    db.close();
    open();
    new GameRepository(db).markAllDisconnected();

    const restored = service.getState(roomCode);
    expect(restored.status).toBe(GAME_STATUS.PLAYING);
    expect(restored.currentPlayerId).toBe(host.playerId);
    expect(restored.turnNumber).toBe(3);
    expect(restored.players.map((p) => [p.name, p.position, p.isConnected])).toEqual([
      ['Mohak', 5, false],
      ['Rahul', 2, false],
    ]);
    expect(restored.lastDiceRoll).toMatchObject({ playerId: guest.playerId, diceValue: 2 });

    service.authenticate(roomCode, guest.playerId, guest.token);
    const { state, events } = service.setConnected(roomCode, guest.playerId, true);
    expect(events).toEqual([{ type: 'PLAYER_RECONNECTED', playerId: guest.playerId, name: 'Rahul' }]);
    expect(state.players.find((p) => p.id === guest.playerId)).toMatchObject({ position: 2, isConnected: true });
  });

  it('only skips a turn if the player is still away on that same turn', () => {
    const { roomCode, host, guest } = startedTwoPlayerGame();
    service.setConnected(roomCode, host.playerId, true);
    expect(service.skipTurn(roomCode, host.playerId, 1).events).toEqual([]);
    service.setConnected(roomCode, host.playerId, false);
    expect(service.skipTurn(roomCode, host.playerId, 99).events).toEqual([]);
    const { state } = service.skipTurn(roomCode, host.playerId, 1);
    expect(state.currentPlayerId).toBe(guest.playerId);
  });

  it('keeps move history when a player leaves and blocks their token afterwards', async () => {
    const host = service.createGame('A');
    const { session: b } = service.joinGame(host.roomCode, 'B');
    const { session: c } = service.joinGame(host.roomCode, 'C');
    service.setReady(host.roomCode, b.playerId, true);
    service.setReady(host.roomCode, c.playerId, true);
    service.startGame(host.roomCode, host.playerId);
    service.beginPlay(host.roomCode);
    service.rollDice(host.roomCode, host.playerId);

    const { state } = service.leave(host.roomCode, host.playerId);
    expect(state.players.map((p) => p.name)).toEqual(['B', 'C']);
    expect(state.players.find((p) => p.isHost)?.name).toBe('B');
    expect(state.status).toBe(GAME_STATUS.PLAYING);
    expect((db.prepare('SELECT COUNT(*) AS n FROM moves').get() as { n: number }).n).toBe(1);
    expect(await errorCode(() => service.authenticate(host.roomCode, host.playerId, host.token))).toBe('NOT_AUTHENTICATED');
  });

  it('plays a full game to a winner and supports a rematch', () => {
    const { roomCode, host } = startedTwoPlayerGame();
    // Host lands exactly on 100 eventually; guest rolls 1s.
    let state = service.getState(roomCode);
    let guard = 0;
    while (state.status === GAME_STATUS.PLAYING && guard++ < 500) {
      const current = state.currentPlayerId!;
      const pos = state.players.find((p) => p.id === current)!.position;
      nextRoll = [current === host.playerId ? Math.min(6, Math.max(1, 100 - pos)) : 1];
      state = service.rollDice(roomCode, current).state;
    }
    expect(state.status).toBe(GAME_STATUS.FINISHED);
    expect(state.winnerId).toBe(host.playerId);
    expect(state.players.find((p) => p.id === host.playerId)!.position).toBe(100);

    const rematch = service.restartGame(roomCode, host.playerId).state;
    expect(rematch).toMatchObject({ status: GAME_STATUS.STARTING, round: 2, winnerId: null, recentMoves: [] });
    expect(rematch.players.every((p) => p.position === 0)).toBe(true);
    expect(service.beginPlay(roomCode).state.currentPlayerId).toBe(host.playerId);
  });
});
