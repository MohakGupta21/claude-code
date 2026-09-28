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
import type { GameRepository } from '../db/gameRepository';
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
 * Application service: loads a game from SQLite, applies an engine rule inside a single
 * transaction, persists the result (including move history) and returns the new public state.
 * SQLite is the source of truth; nothing here is cached between calls.
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

  createGame(name: string): SessionResponse {
    const now = this.timestamp();
    return this.repo.transaction(() => {
      const game: Game = {
        id: randomUUID(),
        roomCode: this.generateRoomCode(),
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
      this.repo.insertGame(game);
      return this.addPlayerTo(game, name, now).session;
    });
  }

  joinGame(roomCode: string, name: string): { session: SessionResponse; events: GameEvent[] } {
    const now = this.timestamp();
    return this.repo.transaction(() => this.addPlayerTo(this.load(roomCode), name, now));
  }

  getState(roomCode: string): GameState {
    return this.toState(this.load(roomCode));
  }

  /** Verifies that a player belongs to the room and holds the secret token issued on join. */
  authenticate(roomCode: string, playerId: string, token: string): void {
    const game = this.load(roomCode);
    const creds = this.repo.credentials(playerId);
    if (!creds || creds.gameId !== game.id || creds.hasLeft) throw Errors.notAuthenticated();
    const expected = Buffer.from(creds.tokenHash, 'hex');
    const actual = Buffer.from(hashToken(token), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Errors.notAuthenticated();
  }

  setConnected(roomCode: string, playerId: string, connected: boolean): ActionResult {
    return this.mutate(roomCode, (game, now) => engine.setConnected(game, playerId, connected, now));
  }

  setReady(roomCode: string, playerId: string, ready: boolean): ActionResult {
    return this.mutate(roomCode, (game, now) => engine.setReady(game, playerId, ready, now));
  }

  startGame(roomCode: string, playerId: string): ActionResult {
    return this.mutate(roomCode, (game, now) => engine.startGame(game, playerId, now, this.startsAt()));
  }

  beginPlay(roomCode: string): ActionResult {
    return this.mutate(roomCode, (game, now) =>
      game.status === GAME_STATUS.STARTING ? engine.beginPlay(game, now) : { game, events: [] },
    );
  }

  rollDice(roomCode: string, playerId: string): ActionResult {
    return this.mutate(roomCode, (game, now) => {
      // Validate before generating randomness so an invalid request never consumes a roll.
      engine.validateMove(game, playerId, 1);
      return engine.applyRoll(game, playerId, this.roll(), getBoard(game.boardId), game.rules, now);
    });
  }

  /** Skips `playerId`'s turn if it is still their turn number `turnNumber` and they are still away. */
  skipTurn(roomCode: string, playerId: string, turnNumber: number): ActionResult {
    return this.mutate(roomCode, (game, now) => {
      const player = game.players.find((p) => p.id === playerId);
      if (!player || player.isConnected || game.turnNumber !== turnNumber) return { game, events: [] };
      return engine.skipTurn(game, playerId, now);
    });
  }

  leave(roomCode: string, playerId: string): ActionResult {
    return this.mutate(roomCode, (game, now) => engine.removePlayer(game, playerId, now));
  }

  /** Removes a lobby player who never came back. In-progress games keep their seat. */
  removeIfStillAway(roomCode: string, playerId: string): ActionResult {
    return this.mutate(roomCode, (game, now) => {
      const player = game.players.find((p) => p.id === playerId);
      if (!player || player.isConnected || game.status !== GAME_STATUS.WAITING) return { game, events: [] };
      return engine.removePlayer(game, playerId, now);
    });
  }

  restartGame(roomCode: string, playerId: string): ActionResult {
    return this.mutate(roomCode, (game, now) => engine.restartGame(game, playerId, now, this.startsAt()));
  }

  roomCodesWithStatus(status: GameStatus): string[] {
    return this.repo.roomCodesWithStatus(status);
  }

  toState(game: Game): GameState {
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
      recentMoves: this.repo.recentMoves(game.id, game.round, RECENT_MOVES_LIMIT, board.size),
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
    };
  }

  // -------------------------------------------------------------------------

  private mutate(roomCode: string, fn: Mutation): ActionResult {
    const now = this.timestamp();
    return this.repo.transaction(() => {
      const before = this.load(roomCode);
      const result = fn(before, now);
      if (result.events.length === 0) return { state: this.toState(before), events: [] };
      if (result.move) this.repo.insertMove(result.game.id, result.game.round, result.move, now);
      this.repo.saveGame(result.game);
      // Re-read so the returned state is exactly what was persisted.
      return { state: this.toState(this.load(roomCode)), events: result.events };
    });
  }

  private addPlayerTo(game: Game, name: string, now: string): { session: SessionResponse; events: GameEvent[] } {
    const playerId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const { game: updated, events } = engine.addPlayer(game, { id: playerId, name, now });
    const player = updated.players.find((p) => p.id === playerId)!;
    this.repo.insertPlayer(game.id, { ...player, position: START_POSITION }, hashToken(token));
    this.repo.saveGame(updated);
    const state = this.toState(this.load(game.roomCode));
    return { session: { roomCode: game.roomCode, playerId, token, state }, events };
  }

  private load(roomCode: string): Game {
    const game = this.repo.findByRoomCode(roomCode);
    if (!game) throw Errors.roomNotFound();
    return game;
  }

  private generateRoomCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.repo.roomCodeExists(code)) return code;
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private startsAt(): string {
    return new Date(this.now().getTime() + this.options.startCountdownMs).toISOString();
  }
}
