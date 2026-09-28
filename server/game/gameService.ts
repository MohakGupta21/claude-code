import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEFAULT_BOARD_ID, getBoard } from '../../shared/boards';
import {
  DEFAULT_RULES,
  GAME_STATUS,
  RECENT_MOVES_LIMIT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  START_POSITION,
  type GameStatus,
} from '../../shared/constants';
import type { SessionResponse } from '../../shared/protocol';
import type { GameEvent, GameState } from '../../shared/types';
import type { FindOptions, GameRepository } from '../db/gameRepository';
import * as engine from '../engine/gameEngine';
import type { Game } from '../engine/model';
import { Errors } from '../errors';

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

export interface GameServiceOptions {
  startCountdownMs: number;
  now?: () => Date;
  rollDice?: () => number;
}

type Mutation = (game: Game, now: string) => engine.EngineResult & { move?: engine.RollResult['move'] };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Application service: loads a game from PostgreSQL, applies an engine rule inside a single
 * transaction, persists the result (including move history) and returns the new public state.
 * The database is the source of truth; nothing here is cached between calls. Every mutation
 * locks the game row first, so concurrent actions on one room are applied one at a time.
 */
export class GameService {
  private readonly now: () => Date;
  private readonly roll: () => number;

  constructor(
    private readonly repo: GameRepository,
    private readonly options: GameServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.roll = options.rollDice ?? (() => engine.rollDice());
  }

  createGame(name: string): Promise<SessionResponse> {
    const now = this.timestamp();
    return this.repo.transaction(async (tx) => {
      const game: Game = {
        id: randomUUID(),
        roomCode: await this.generateRoomCode(tx),
        status: GAME_STATUS.WAITING,
        boardId: DEFAULT_BOARD_ID,
        rules: DEFAULT_RULES,
        currentPlayerId: null,
        winnerId: null,
        turnNumber: 0,
        round: 1,
        lastRoll: null,
        startsAt: null,
        createdAt: now,
        updatedAt: now,
        players: [],
      };
      await tx.insertGame(game);
      return (await this.addPlayerTo(tx, game, name, now)).session;
    });
  }

  joinGame(roomCode: string, name: string): Promise<{ session: SessionResponse; events: GameEvent[] }> {
    const now = this.timestamp();
    return this.repo.transaction(async (tx) =>
      this.addPlayerTo(tx, await this.load(tx, roomCode, { forUpdate: true }), name, now),
    );
  }

  async getState(roomCode: string): Promise<GameState> {
    return this.toState(this.repo, await this.load(this.repo, roomCode));
  }

  /** Verifies that a player belongs to the room and holds the secret token issued on join. */
  async authenticate(roomCode: string, playerId: string, token: string): Promise<void> {
    const game = await this.load(this.repo, roomCode);
    const creds = await this.repo.credentials(playerId);
    if (!creds || creds.gameId !== game.id || creds.hasLeft) throw Errors.notAuthenticated();
    const expected = Buffer.from(creds.tokenHash, 'hex');
    const actual = Buffer.from(hashToken(token), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Errors.notAuthenticated();
  }

  setConnected(roomCode: string, playerId: string, connected: boolean): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => engine.setConnected(game, playerId, connected, now));
  }

  setReady(roomCode: string, playerId: string, ready: boolean): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => engine.setReady(game, playerId, ready, now));
  }

  startGame(roomCode: string, playerId: string): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => engine.startGame(game, playerId, now, this.startsAt()));
  }

  beginPlay(roomCode: string): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) =>
      game.status === GAME_STATUS.STARTING ? engine.beginPlay(game, now) : { game, events: [] },
    );
  }

  rollDice(roomCode: string, playerId: string): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => {
      // Validate before generating randomness so an invalid request never consumes a roll.
      engine.validateMove(game, playerId, 1);
      return engine.applyRoll(game, playerId, this.roll(), getBoard(game.boardId), game.rules, now);
    });
  }

  /** Skips `playerId`'s turn if it is still their turn number `turnNumber` and they are still away. */
  skipTurn(roomCode: string, playerId: string, turnNumber: number): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => {
      const player = game.players.find((p) => p.id === playerId);
      if (!player || player.isConnected || game.turnNumber !== turnNumber) return { game, events: [] };
      return engine.skipTurn(game, playerId, now);
    });
  }

  leave(roomCode: string, playerId: string): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => engine.removePlayer(game, playerId, now));
  }

  /** Removes a lobby player who never came back. In-progress games keep their seat. */
  removeIfStillAway(roomCode: string, playerId: string): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => {
      const player = game.players.find((p) => p.id === playerId);
      if (!player || player.isConnected || game.status !== GAME_STATUS.WAITING) return { game, events: [] };
      return engine.removePlayer(game, playerId, now);
    });
  }

  restartGame(roomCode: string, playerId: string): Promise<ActionResult> {
    return this.mutate(roomCode, (game, now) => engine.restartGame(game, playerId, now, this.startsAt()));
  }

  roomCodesWithStatus(status: GameStatus): Promise<string[]> {
    return this.repo.roomCodesWithStatus(status);
  }

  private async toState(repo: GameRepository, game: Game): Promise<GameState> {
    const board = getBoard(game.boardId);
    return {
      gameId: game.id,
      roomCode: game.roomCode,
      status: game.status,
      players: engine.sortByTurnOrder(game.players),
      currentPlayerId: game.currentPlayerId,
      winnerId: game.winnerId,
      board,
      rules: game.rules,
      lastDiceRoll: game.lastRoll,
      turnNumber: game.turnNumber,
      round: game.round,
      startsAt: game.startsAt,
      recentMoves: await repo.recentMoves(game.id, game.round, RECENT_MOVES_LIMIT, board.size),
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
    };
  }

  // -------------------------------------------------------------------------

  private mutate(roomCode: string, fn: Mutation): Promise<ActionResult> {
    const now = this.timestamp();
    return this.repo.transaction(async (tx) => {
      const before = await this.load(tx, roomCode, { forUpdate: true });
      const result = fn(before, now);
      if (result.events.length === 0) return { state: await this.toState(tx, before), events: [] };
      if (result.move) await tx.insertMove(result.game.id, result.game.round, result.move, now);
      await tx.saveGame(result.game);
      // Re-read so the returned state is exactly what was persisted.
      return { state: await this.toState(tx, await this.load(tx, roomCode)), events: result.events };
    });
  }

  private async addPlayerTo(
    tx: GameRepository,
    game: Game,
    name: string,
    now: string,
  ): Promise<{ session: SessionResponse; events: GameEvent[] }> {
    const playerId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const { game: updated, events } = engine.addPlayer(game, { id: playerId, name, now });
    const player = updated.players.find((p) => p.id === playerId)!;
    await tx.insertPlayer(game.id, { ...player, position: START_POSITION }, hashToken(token));
    await tx.saveGame(updated);
    const state = await this.toState(tx, await this.load(tx, game.roomCode));
    return { session: { roomCode: game.roomCode, playerId, token, state }, events };
  }

  private async load(repo: GameRepository, roomCode: string, options?: FindOptions): Promise<Game> {
    const game = await repo.findByRoomCode(roomCode, options);
    if (!game) throw Errors.roomNotFound();
    return game;
  }

  private async generateRoomCode(tx: GameRepository): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!(await tx.roomCodeExists(code))) return code;
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private startsAt(): string {
    return new Date(this.now().getTime() + this.options.startCountdownMs).toISOString();
  }
}
