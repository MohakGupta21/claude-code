import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAME_STATUS, MAX_PLAYERS } from '../shared/constants';
import { openDatabase, type Database } from '../server/db/database';
import { GameRepository } from '../server/db/gameRepository';
import { GameService } from '../server/game/gameService';
import { GameError } from '../server/errors';
import { createTestDatabase, type TestDatabase } from './testDatabase';

let testDb: TestDatabase;
let db: Database;
let service: GameService;
let nextRoll: number[];

async function open() {
  db = await openDatabase({ connectionString: testDb.url });
  service = new GameService(GameRepository.forPool(db), {
    startCountdownMs: 0,
    rollDice: () => nextRoll.shift() ?? 1,
  });
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  nextRoll = [];
  await open();
});

afterEach(async () => {
  await db.end();
  await testDb.drop();
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
async function startedTwoPlayerGame() {
  const host = await service.createGame('Mohak');
  const { session: guest } = await service.joinGame(host.roomCode, 'Rahul');
  await service.setReady(host.roomCode, guest.playerId, true);
  await service.startGame(host.roomCode, host.playerId);
  await service.beginPlay(host.roomCode);
  return { roomCode: host.roomCode, host, guest };
}

describe('GameService', () => {
  it('creates a room with the creator as host', async () => {
    const session = await service.createGame('Mohak');
    expect(session.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(session.token).toMatch(/^[0-9a-f]{64}$/);
    expect(session.state.status).toBe(GAME_STATUS.WAITING);
    expect(session.state.players).toMatchObject([{ id: session.playerId, name: 'Mohak', isHost: true }]);
  });

  it('lets multiple players join and enforces capacity', async () => {
    const host = await service.createGame('P1');
    for (let i = 2; i <= MAX_PLAYERS; i++) await service.joinGame(host.roomCode, `P${i}`);
    expect((await service.getState(host.roomCode)).players).toHaveLength(MAX_PLAYERS);
    expect(await errorCode(() => service.joinGame(host.roomCode, 'Extra'))).toBe('ROOM_FULL');
  });

  it('rejects joining unknown rooms and rooms that already started', async () => {
    expect(await errorCode(() => service.joinGame('ZZZZZZ', 'Nobody'))).toBe('ROOM_NOT_FOUND');
    const { roomCode } = await startedTwoPlayerGame();
    expect(await errorCode(() => service.joinGame(roomCode, 'Late'))).toBe('GAME_ALREADY_STARTED');
  });

  it('authenticates players by their secret token only', async () => {
    const host = await service.createGame('Mohak');
    const other = await service.createGame('Amit');
    await expect(service.authenticate(host.roomCode, host.playerId, host.token)).resolves.toBeUndefined();
    expect(await errorCode(() => service.authenticate(host.roomCode, host.playerId, other.token))).toBe('NOT_AUTHENTICATED');
    expect(await errorCode(() => service.authenticate(host.roomCode, other.playerId, other.token))).toBe('NOT_AUTHENTICATED');
  });

  it('generates dice server-side, persists the move and passes the turn', async () => {
    const { roomCode, host, guest } = await startedTwoPlayerGame();
    nextRoll = [3];
    expect(await errorCode(() => service.rollDice(roomCode, guest.playerId))).toBe('NOT_YOUR_TURN');

    const { state, events } = await service.rollDice(roomCode, host.playerId);
    expect(state.lastDiceRoll).toMatchObject({ playerId: host.playerId, diceValue: 3, finalPosition: 3 });
    expect(state.currentPlayerId).toBe(guest.playerId);
    expect(state.turnNumber).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['DICE_ROLLED', 'PLAYER_MOVED', 'TURN_CHANGED']);

    const { rows: moves } = await db.query('SELECT * FROM moves');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ dice_value: 3, start_position: 0, end_position: 3, final_position: 3 });
  });

  it('lets a player who rolls a 6 roll again, and persists it', async () => {
    const { roomCode, host, guest } = await startedTwoPlayerGame();
    nextRoll = [6];
    const { state, events } = await service.rollDice(roomCode, host.playerId);
    expect(state.currentPlayerId).toBe(host.playerId);
    expect(state.lastDiceRoll).toMatchObject({ diceValue: 6, extraTurn: true });
    expect(events.map((e) => e.type)).toContain('EXTRA_TURN');
    expect(await errorCode(() => service.rollDice(roomCode, guest.playerId))).toBe('NOT_YOUR_TURN');

    await db.end();
    await open();
    const restored = await service.getState(roomCode);
    expect(restored).toMatchObject({ currentPlayerId: host.playerId, rules: { extraTurnOn: 6 } });
    expect(restored.lastDiceRoll).toMatchObject({ extraTurn: true });

    nextRoll = [2];
    expect((await service.rollDice(roomCode, host.playerId)).state.currentPlayerId).toBe(guest.playerId);
  });

  it('serialises concurrent joins so capacity is never exceeded', async () => {
    const host = await service.createGame('P1');
    const names = Array.from({ length: MAX_PLAYERS + 3 }, (_, i) => `Guest${i}`);
    const results = await Promise.allSettled(names.map((name) => service.joinGame(host.roomCode, name)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_PLAYERS - 1);
    const players = (await service.getState(host.roomCode)).players;
    expect(players).toHaveLength(MAX_PLAYERS);
    expect(new Set(players.map((p) => p.turnOrder)).size).toBe(MAX_PLAYERS);
  });

  it('accepts only one of several simultaneous rolls from the same player', async () => {
    const { roomCode, host } = await startedTwoPlayerGame();
    nextRoll = [3, 3, 3, 3, 3];
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.rollDice(roomCode, host.playerId)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM moves')).rows[0].n).toBe(1);
    expect((await service.getState(roomCode)).turnNumber).toBe(2);
  });

  it('applies ladders and records both landing and final squares', async () => {
    const { roomCode, host } = await startedTwoPlayerGame();
    nextRoll = [4]; // 0 → 4, classic ladder 4 → 14
    const { state, events } = await service.rollDice(roomCode, host.playerId);
    expect(state.players.find((p) => p.id === host.playerId)!.position).toBe(14);
    expect(events).toContainEqual({ type: 'LADDER_TRIGGERED', playerId: host.playerId, from: 4, to: 14 });
    expect(state.recentMoves[0]).toMatchObject({ endPosition: 4, finalPosition: 14, jump: 'ladder' });
  });

  it('persists game state across a restart and preserves reconnecting players', async () => {
    const { roomCode, host, guest } = await startedTwoPlayerGame();
    await service.setConnected(roomCode, host.playerId, true);
    await service.setConnected(roomCode, guest.playerId, true);
    nextRoll = [5, 2];
    await service.rollDice(roomCode, host.playerId);
    await service.rollDice(roomCode, guest.playerId);
    await service.setConnected(roomCode, guest.playerId, false);

    // Simulate a process restart.
    await db.end();
    await open();
    await GameRepository.forPool(db).markAllDisconnected();

    const restored = await service.getState(roomCode);
    expect(restored.status).toBe(GAME_STATUS.PLAYING);
    expect(restored.currentPlayerId).toBe(host.playerId);
    expect(restored.turnNumber).toBe(3);
    expect(restored.players.map((p) => [p.name, p.position, p.isConnected])).toEqual([
      ['Mohak', 5, false],
      ['Rahul', 2, false],
    ]);
    expect(restored.lastDiceRoll).toMatchObject({ playerId: guest.playerId, diceValue: 2 });

    await service.authenticate(roomCode, guest.playerId, guest.token);
    const { state, events } = await service.setConnected(roomCode, guest.playerId, true);
    expect(events).toEqual([{ type: 'PLAYER_RECONNECTED', playerId: guest.playerId, name: 'Rahul' }]);
    expect(state.players.find((p) => p.id === guest.playerId)).toMatchObject({ position: 2, isConnected: true });
  });

  it('only skips a turn if the player is still away on that same turn', async () => {
    const { roomCode, host, guest } = await startedTwoPlayerGame();
    await service.setConnected(roomCode, host.playerId, true);
    expect((await service.skipTurn(roomCode, host.playerId, 1)).events).toEqual([]);
    await service.setConnected(roomCode, host.playerId, false);
    expect((await service.skipTurn(roomCode, host.playerId, 99)).events).toEqual([]);
    const { state } = await service.skipTurn(roomCode, host.playerId, 1);
    expect(state.currentPlayerId).toBe(guest.playerId);
  });

  it('keeps move history when a player leaves and blocks their token afterwards', async () => {
    const host = await service.createGame('A');
    const { session: b } = await service.joinGame(host.roomCode, 'B');
    const { session: c } = await service.joinGame(host.roomCode, 'C');
    await service.setReady(host.roomCode, b.playerId, true);
    await service.setReady(host.roomCode, c.playerId, true);
    await service.startGame(host.roomCode, host.playerId);
    await service.beginPlay(host.roomCode);
    await service.rollDice(host.roomCode, host.playerId);

    const { state } = await service.leave(host.roomCode, host.playerId);
    expect(state.players.map((p) => p.name)).toEqual(['B', 'C']);
    expect(state.players.find((p) => p.isHost)?.name).toBe('B');
    expect(state.status).toBe(GAME_STATUS.PLAYING);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM moves')).rows[0].n).toBe(1);
    expect(await errorCode(() => service.authenticate(host.roomCode, host.playerId, host.token))).toBe('NOT_AUTHENTICATED');
  });

  it('plays a full game to a winner and supports a rematch', async () => {
    const { roomCode, host } = await startedTwoPlayerGame();
    // Host lands exactly on 100 eventually; guest rolls 1s.
    let state = await service.getState(roomCode);
    let guard = 0;
    while (state.status === GAME_STATUS.PLAYING && guard++ < 500) {
      const current = state.currentPlayerId!;
      const pos = state.players.find((p) => p.id === current)!.position;
      nextRoll = [current === host.playerId ? Math.min(6, Math.max(1, 100 - pos)) : 1];
      state = (await service.rollDice(roomCode, current)).state;
    }
    expect(state.status).toBe(GAME_STATUS.FINISHED);
    expect(state.winnerId).toBe(host.playerId);
    expect(state.players.find((p) => p.id === host.playerId)!.position).toBe(100);

    const rematch = (await service.restartGame(roomCode, host.playerId)).state;
    expect(rematch).toMatchObject({ status: GAME_STATUS.STARTING, round: 2, winnerId: null, recentMoves: [] });
    expect(rematch.players.every((p) => p.position === 0)).toBe(true);
    expect((await service.beginPlay(roomCode)).state.currentPlayerId).toBe(host.playerId);
  });
});
