import { describe, expect, it } from 'vitest';
import { CLASSIC_BOARD, validateBoard, type BoardConfig } from '../shared/boards';
import { squareToCoord, squaresInDisplayOrder } from '../shared/boardLayout';
import { DICE_MAX, DICE_MIN, GAME_STATUS, MAX_PLAYERS } from '../shared/constants';
import * as engine from '../server/engine/gameEngine';
import { GameError } from '../server/errors';
import { makeGame, makePlayer, NOW, playingGame } from './helpers';

const board: BoardConfig = {
  id: 'test',
  name: 'Test',
  size: 100,
  snakes: { 42: 17, 99: 54 },
  ladders: { 23: 56, 4: 25 },
};
const exact = { finishRule: 'exact', extraTurnOn: null } as const;
const sixRollsAgain = { finishRule: 'exact', extraTurnOn: 6 } as const;

function expectGameError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GameError);
    expect((error as GameError).code).toBe(code);
    return;
  }
  throw new Error(`Expected GameError ${code}`);
}

describe('dice', () => {
  it('always rolls a value between 1 and 6', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = engine.rollDice();
      expect(value).toBeGreaterThanOrEqual(DICE_MIN);
      expect(value).toBeLessThanOrEqual(DICE_MAX);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect(seen.size).toBe(DICE_MAX - DICE_MIN + 1);
  });

  it('uses the injected random source with an exclusive upper bound', () => {
    expect(engine.rollDice((_min, max) => max - 1)).toBe(DICE_MAX);
    expect(engine.rollDice((min) => min)).toBe(DICE_MIN);
  });

  it('rejects out-of-range dice values', () => {
    expectGameError(() => engine.applyRoll(playingGame(), 'a', 7, board, exact, NOW), 'INVALID_MOVE');
    expectGameError(() => engine.applyRoll(playingGame(), 'a', 0, board, exact, NOW), 'INVALID_MOVE');
    expectGameError(() => engine.applyRoll(playingGame(), 'a', 2.5, board, exact, NOW), 'INVALID_MOVE');
  });
});

describe('movement', () => {
  it('moves the player forward by the dice value', () => {
    const { game, move } = engine.applyRoll(playingGame({ a: 10 }), 'a', 5, board, exact, NOW);
    expect(move).toMatchObject({ startPosition: 10, endPosition: 15, finalPosition: 15, jump: null });
    expect(game.players.find((p) => p.id === 'a')!.position).toBe(15);
  });

  it('enters the board from the start position', () => {
    const { move } = engine.applyRoll(playingGame(), 'a', 3, board, exact, NOW);
    expect(move.finalPosition).toBe(3);
  });

  it('does not let a player move when it is not their turn', () => {
    expectGameError(() => engine.applyRoll(playingGame(), 'b', 3, board, exact, NOW), 'NOT_YOUR_TURN');
  });

  it('does not let unknown players move', () => {
    expectGameError(() => engine.applyRoll(playingGame(), 'zzz', 3, board, exact, NOW), 'INVALID_PLAYER');
  });

  it('does not allow moves unless the game is playing', () => {
    const game = { ...playingGame(), status: GAME_STATUS.FINISHED };
    expectGameError(() => engine.applyRoll(game, 'a', 3, board, exact, NOW), 'GAME_NOT_ACTIVE');
    const waiting = { ...playingGame(), status: GAME_STATUS.WAITING };
    expectGameError(() => engine.applyRoll(waiting, 'a', 3, board, exact, NOW), 'GAME_NOT_ACTIVE');
  });

  it('never moves a player past the final square (exact rule)', () => {
    const { game, move, events } = engine.applyRoll(playingGame({ a: 96 }), 'a', 5, board, exact, NOW);
    expect(move).toMatchObject({ blocked: true, finalPosition: 96, won: false });
    expect(game.players.find((p) => p.id === 'a')!.position).toBe(96);
    expect(events.map((e) => e.type)).not.toContain('PLAYER_MOVED');
    expect(game.currentPlayerId).toBe('b');
  });

  it('supports the bounce and overshoot finish rules', () => {
    expect(engine.movePlayer(97, 5, 100, { finishRule: 'bounce' })).toEqual({ position: 98, blocked: false, bounced: true });
    expect(engine.movePlayer(97, 5, 100, { finishRule: 'overshoot' })).toEqual({ position: 100, blocked: false, bounced: false });
    for (let pos = 0; pos <= 100; pos++) {
      for (let dice = 1; dice <= 6; dice++) {
        for (const finishRule of ['exact', 'bounce', 'overshoot'] as const) {
          expect(engine.movePlayer(pos, dice, 100, { finishRule }).position).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('snakes and ladders', () => {
  it('moves a player down when they land on a snake head', () => {
    const { move, events } = engine.applyRoll(playingGame({ a: 40 }), 'a', 2, board, exact, NOW);
    expect(move).toMatchObject({ endPosition: 42, finalPosition: 17, jump: 'snake' });
    expect(events).toContainEqual({ type: 'SNAKE_TRIGGERED', playerId: 'a', from: 42, to: 17 });
  });

  it('moves a player up when they land on a ladder bottom', () => {
    const { move, events } = engine.applyRoll(playingGame({ a: 20 }), 'a', 3, board, exact, NOW);
    expect(move).toMatchObject({ endPosition: 23, finalPosition: 56, jump: 'ladder' });
    expect(events).toContainEqual({ type: 'LADDER_TRIGGERED', playerId: 'a', from: 23, to: 56 });
  });

  it('exposes snake and ladder lookups', () => {
    expect(engine.applySnake(99, board)).toBe(54);
    expect(engine.applySnake(50, board)).toBeNull();
    expect(engine.applyLadder(4, board)).toBe(25);
    expect(engine.applyLadder(5, board)).toBeNull();
  });

  it('ships a valid classic board', () => {
    expect(validateBoard(CLASSIC_BOARD)).toEqual([]);
  });

  it('detects invalid boards', () => {
    const bad: BoardConfig = { ...board, snakes: { 30: 40, 56: 10 }, ladders: { 10: 5, 23: 56 } };
    const problems = validateBoard(bad);
    expect(problems).toContain('snake 30→40 must go down');
    expect(problems).toContain('ladder 10→5 must go up');
    expect(problems.some((p) => p.includes('both a jump start and a jump end'))).toBe(true);
  });
});

describe('winning', () => {
  it('declares a winner who lands exactly on 100', () => {
    const { game, move, events } = engine.applyRoll(playingGame({ a: 96 }), 'a', 4, board, exact, NOW);
    expect(move.won).toBe(true);
    expect(engine.checkWinner(100, board)).toBe(true);
    expect(game).toMatchObject({ status: GAME_STATUS.FINISHED, winnerId: 'a', currentPlayerId: null });
    expect(events.at(-1)).toEqual({ type: 'GAME_WON', playerId: 'a', name: 'a' });
    expect(events.map((e) => e.type)).not.toContain('TURN_CHANGED');
  });

  it('stops turn progression after a win', () => {
    const { game } = engine.applyRoll(playingGame({ a: 96 }), 'a', 4, board, exact, NOW);
    expectGameError(() => engine.applyRoll(game, 'b', 3, board, exact, NOW), 'GAME_NOT_ACTIVE');
  });
});

describe('turn management', () => {
  it('passes the turn in a consistent order and wraps around', () => {
    let game = playingGame();
    const order: string[] = [];
    for (let i = 0; i < 7; i++) {
      order.push(game.currentPlayerId!);
      game = engine.applyRoll(game, game.currentPlayerId!, 1, board, exact, NOW).game;
    }
    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
    expect(game.turnNumber).toBe(8);
  });

  it('gives the same player another turn after rolling a 6', () => {
    const { game, move, events } = engine.applyRoll(playingGame({ a: 10 }), 'a', 6, board, sixRollsAgain, NOW);
    expect(move).toMatchObject({ finalPosition: 16, extraTurn: true });
    expect(game).toMatchObject({ currentPlayerId: 'a', turnNumber: 2 });
    expect(events).toContainEqual({ type: 'EXTRA_TURN', playerId: 'a', name: 'a', diceValue: 6 });
    expect(events.at(-1)).toEqual({ type: 'TURN_CHANGED', playerId: 'a', turnNumber: 2 });

    const after = engine.applyRoll(game, 'a', 2, board, sixRollsAgain, NOW);
    expect(after.move.extraTurn).toBe(false);
    expect(after.game.currentPlayerId).toBe('b');
  });

  it('grants an extra turn on a 6 even after a snake or a blocked roll', () => {
    expect(engine.applyRoll(playingGame({ a: 36 }), 'a', 6, board, sixRollsAgain, NOW).game.currentPlayerId).toBe('a');
    const blocked = engine.applyRoll(playingGame({ a: 97 }), 'a', 6, board, sixRollsAgain, NOW);
    expect(blocked.move).toMatchObject({ blocked: true, extraTurn: true });
    expect(blocked.game.currentPlayerId).toBe('a');
  });

  it('ends the game instead of granting an extra turn when a 6 wins', () => {
    const { game, move } = engine.applyRoll(playingGame({ a: 94 }), 'a', 6, board, sixRollsAgain, NOW);
    expect(move).toMatchObject({ won: true, extraTurn: false });
    expect(game).toMatchObject({ status: GAME_STATUS.FINISHED, currentPlayerId: null });
  });

  it('passes the turn on a 6 when extra turns are disabled', () => {
    expect(engine.applyRoll(playingGame({ a: 10 }), 'a', 6, board, exact, NOW).game.currentPlayerId).toBe('b');
  });

  it('computes the next turn by turn order regardless of array order', () => {
    const players = [makePlayer({ id: 'x', turnOrder: 3 }), makePlayer({ id: 'y', turnOrder: 1 }), makePlayer({ id: 'z', turnOrder: 2 })];
    expect(engine.nextTurn(players, 'y')).toBe('z');
    expect(engine.nextTurn(players, 'z')).toBe('x');
    expect(engine.nextTurn(players, 'x')).toBe('y');
  });

  it('skips a disconnected player', () => {
    const { game, events } = engine.skipTurn(playingGame(), 'a', NOW);
    expect(game.currentPlayerId).toBe('b');
    expect(events.map((e) => e.type)).toEqual(['TURN_SKIPPED', 'TURN_CHANGED']);
  });

  it('hands the turn to the next player when the current player leaves', () => {
    const start = { ...playingGame(), currentPlayerId: 'b' };
    const { game } = engine.removePlayer(start, 'b', NOW);
    expect(game.currentPlayerId).toBe('c');
    const { game: wrap } = engine.removePlayer({ ...playingGame(), currentPlayerId: 'c' }, 'c', NOW);
    expect(wrap.currentPlayerId).toBe('a');
  });
});

describe('lobby', () => {
  function lobbyWith(count: number) {
    let game = makeGame();
    for (let i = 0; i < count; i++) {
      game = engine.addPlayer(game, { id: `p${i}`, name: `Player ${i}`, now: NOW }).game;
    }
    return game;
  }

  it('lets multiple players join with distinct colors and makes the first the host', () => {
    const game = lobbyWith(4);
    expect(game.players).toHaveLength(4);
    expect(new Set(game.players.map((p) => p.color)).size).toBe(4);
    expect(game.players.filter((p) => p.isHost).map((p) => p.id)).toEqual(['p0']);
    expect(game.players.map((p) => p.turnOrder)).toEqual([1, 2, 3, 4]);
  });

  it('enforces room capacity', () => {
    expectGameError(() => engine.addPlayer(lobbyWith(MAX_PLAYERS), { id: 'x', name: 'Extra', now: NOW }), 'ROOM_FULL');
  });

  it('rejects duplicate names and joining after the game has started', () => {
    expectGameError(() => engine.addPlayer(lobbyWith(2), { id: 'x', name: 'player 1', now: NOW }), 'NAME_TAKEN');
    expectGameError(() => engine.addPlayer(playingGame(), { id: 'x', name: 'Late', now: NOW }), 'GAME_ALREADY_STARTED');
  });

  it('requires the host, enough players, and everyone ready to start', () => {
    const game = lobbyWith(2);
    expectGameError(() => engine.startGame(lobbyWith(1), 'p0', NOW, NOW), 'NOT_ENOUGH_PLAYERS');
    expectGameError(() => engine.startGame(game, 'p1', NOW, NOW), 'NOT_HOST');
    expectGameError(() => engine.startGame(game, 'p0', NOW, NOW), 'PLAYERS_NOT_READY');

    const ready = engine.setReady(game, 'p1', true, NOW).game;
    const starting = engine.startGame(ready, 'p0', NOW, NOW).game;
    expect(starting.status).toBe(GAME_STATUS.STARTING);
    const { game: playing, events } = engine.beginPlay(starting, NOW);
    expect(playing).toMatchObject({ status: GAME_STATUS.PLAYING, currentPlayerId: 'p0', turnNumber: 1 });
    expect(events[0]).toEqual({ type: 'GAME_STARTED' });
  });

  it('reassigns the host when the host leaves and abandons an empty room', () => {
    const { game, events } = engine.removePlayer(lobbyWith(3), 'p0', NOW);
    expect(game.players.find((p) => p.isHost)?.id).toBe('p1');
    expect(events.map((e) => e.type)).toEqual(['PLAYER_LEFT', 'HOST_CHANGED']);
    const empty = engine.removePlayer(lobbyWith(1), 'p0', NOW).game;
    expect(empty.status).toBe(GAME_STATUS.ABANDONED);
  });

  it('abandons a game in progress when too few players remain', () => {
    const twoPlayer = { ...playingGame(), players: playingGame().players.slice(0, 2) };
    const { game } = engine.removePlayer(twoPlayer, 'b', NOW);
    expect(game.status).toBe(GAME_STATUS.ABANDONED);
  });
});

describe('restart', () => {
  it('resets positions and starts a new round with the same players', () => {
    const finished = engine.applyRoll(playingGame({ a: 96, b: 50 }), 'a', 4, board, exact, NOW).game;
    expectGameError(() => engine.restartGame(finished, 'b', NOW, NOW), 'NOT_HOST');
    const { game } = engine.restartGame(finished, 'a', NOW, NOW);
    expect(game).toMatchObject({ status: GAME_STATUS.STARTING, round: 2, winnerId: null, lastRoll: null });
    expect(game.players.every((p) => p.position === 0)).toBe(true);
  });
});

describe('board layout', () => {
  it('numbers squares in a zig-zag starting bottom-left', () => {
    expect(squareToCoord(1, 100)).toEqual({ row: 9, col: 0 });
    expect(squareToCoord(10, 100)).toEqual({ row: 9, col: 9 });
    expect(squareToCoord(11, 100)).toEqual({ row: 8, col: 9 });
    expect(squareToCoord(100, 100)).toEqual({ row: 0, col: 0 });
    expect(squareToCoord(91, 100)).toEqual({ row: 0, col: 9 });
    const order = squaresInDisplayOrder(100);
    expect(order.slice(0, 10)).toEqual([100, 99, 98, 97, 96, 95, 94, 93, 92, 91]);
    expect(order.slice(10, 20)).toEqual([81, 82, 83, 84, 85, 86, 87, 88, 89, 90]);
    expect(order.slice(90)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
