import { getBoard } from '../../shared/boards';
import type { FinishRule, GameStatus, PlayerColor } from '../../shared/constants';
import type { JumpKind, MoveLogEntry, MoveResult } from '../../shared/types';
import type { Game, Player } from '../engine/model';
import type { Database } from './database';

interface GameRow {
  id: string;
  room_code: string;
  status: GameStatus;
  board_id: string;
  finish_rule: FinishRule;
  current_player_id: string | null;
  winner_id: string | null;
  turn_number: number;
  round: number;
  starts_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PlayerRow {
  id: string;
  game_id: string;
  name: string;
  color: PlayerColor;
  position: number;
  turn_order: number;
  is_host: number;
  is_connected: number;
  is_ready: number;
  created_at: string;
}

interface MoveRow {
  id: number;
  player_id: string;
  turn_number: number;
  dice_value: number;
  start_position: number;
  end_position: number;
  final_position: number;
  jump: JumpKind | null;
  blocked: number;
  bounced: number;
  created_at: string;
}

export interface PlayerCredentials {
  gameId: string;
  tokenHash: string;
  hasLeft: boolean;
}

const toPlayer = (row: PlayerRow): Player => ({
  id: row.id,
  name: row.name,
  color: row.color,
  position: row.position,
  isHost: row.is_host === 1,
  isConnected: row.is_connected === 1,
  isReady: row.is_ready === 1,
  turnOrder: row.turn_order,
  joinedAt: row.created_at,
});

const bool = (value: boolean) => (value ? 1 : 0);

/**
 * All SQL for games, players and moves. Every query is parameterised.
 * Callers are responsible for wrapping multi-statement changes in a transaction.
 */
export class GameRepository {
  private readonly stmt;

  constructor(private readonly db: Database) {
    this.stmt = {
      insertGame: db.prepare(`
        INSERT INTO games (id, room_code, status, board_id, finish_rule, current_player_id, winner_id,
                           turn_number, round, starts_at, created_at, updated_at)
        VALUES (@id, @roomCode, @status, @boardId, @finishRule, @currentPlayerId, @winnerId,
                @turnNumber, @round, @startsAt, @createdAt, @updatedAt)`),
      updateGame: db.prepare(`
        UPDATE games SET status = @status, current_player_id = @currentPlayerId, winner_id = @winnerId,
                         turn_number = @turnNumber, round = @round, starts_at = @startsAt, updated_at = @updatedAt
        WHERE id = @id`),
      gameByRoomCode: db.prepare('SELECT * FROM games WHERE room_code = ?'),
      roomCodesByStatus: db.prepare('SELECT room_code FROM games WHERE status = ?'),
      roomCodeExists: db.prepare('SELECT 1 FROM games WHERE room_code = ?'),
      insertPlayer: db.prepare(`
        INSERT INTO players (id, game_id, name, color, position, turn_order, is_host, is_connected, is_ready,
                             token_hash, created_at, updated_at)
        VALUES (@id, @gameId, @name, @color, @position, @turnOrder, @isHost, @isConnected, @isReady,
                @tokenHash, @createdAt, @createdAt)`),
      updatePlayer: db.prepare(`
        UPDATE players SET position = @position, is_host = @isHost, is_connected = @isConnected,
                           is_ready = @isReady, updated_at = @updatedAt
        WHERE id = @id AND game_id = @gameId AND left_at IS NULL`),
      markPlayerLeft: db.prepare(`
        UPDATE players SET left_at = @now, is_connected = 0, is_host = 0, updated_at = @now
        WHERE id = @id AND game_id = @gameId AND left_at IS NULL`),
      activePlayers: db.prepare('SELECT * FROM players WHERE game_id = ? AND left_at IS NULL ORDER BY turn_order'),
      credentials: db.prepare('SELECT game_id, token_hash, left_at FROM players WHERE id = ?'),
      markAllDisconnected: db.prepare('UPDATE players SET is_connected = 0 WHERE is_connected = 1'),
      insertMove: db.prepare(`
        INSERT INTO moves (game_id, player_id, round, turn_number, dice_value, start_position, end_position,
                           final_position, jump, blocked, bounced, created_at)
        VALUES (@gameId, @playerId, @round, @turnNumber, @diceValue, @startPosition, @endPosition,
                @finalPosition, @jump, @blocked, @bounced, @createdAt)`),
      recentMoves: db.prepare(`
        SELECT * FROM moves WHERE game_id = ? AND round = ? ORDER BY id DESC LIMIT ?`),
      allMoves: db.prepare('SELECT * FROM moves WHERE game_id = ? ORDER BY id'),
    };
  }

  transaction<T>(fn: () => T): T {
    // IMMEDIATE takes the write lock up front so concurrent writers serialise cleanly.
    return this.db.transaction(fn).immediate();
  }

  roomCodeExists(roomCode: string): boolean {
    return this.stmt.roomCodeExists.get(roomCode) !== undefined;
  }

  insertGame(game: Game): void {
    this.stmt.insertGame.run({ ...this.gameParams(game), roomCode: game.roomCode, boardId: game.boardId,
      finishRule: game.rules.finishRule, createdAt: game.createdAt });
  }

  findByRoomCode(roomCode: string): Game | null {
    const row = this.stmt.gameByRoomCode.get(roomCode) as GameRow | undefined;
    if (!row) return null;
    const players = (this.stmt.activePlayers.all(row.id) as PlayerRow[]).map(toPlayer);
    const [lastMove] = this.recentMoves(row.id, row.round, 1, getBoard(row.board_id).size);
    return {
      id: row.id,
      roomCode: row.room_code,
      status: row.status,
      boardId: row.board_id,
      rules: { finishRule: row.finish_rule },
      currentPlayerId: row.current_player_id,
      winnerId: row.winner_id,
      turnNumber: row.turn_number,
      round: row.round,
      lastRoll: lastMove ? stripLogFields(lastMove) : null,
      startsAt: row.starts_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      players,
    };
  }

  roomCodesWithStatus(status: GameStatus): string[] {
    return (this.stmt.roomCodesByStatus.all(status) as { room_code: string }[]).map((r) => r.room_code);
  }

  insertPlayer(gameId: string, player: Player, tokenHash: string): void {
    this.stmt.insertPlayer.run({
      id: player.id,
      gameId,
      name: player.name,
      color: player.color,
      position: player.position,
      turnOrder: player.turnOrder,
      isHost: bool(player.isHost),
      isConnected: bool(player.isConnected),
      isReady: bool(player.isReady),
      tokenHash,
      createdAt: player.joinedAt,
    });
  }

  /**
   * Persists a game produced by the engine: the game row, every active player, and marks
   * players that are no longer in the game as having left (their move history is kept).
   */
  saveGame(game: Game): void {
    const stillActive = new Set(game.players.map((p) => p.id));
    for (const row of this.stmt.activePlayers.all(game.id) as PlayerRow[]) {
      if (!stillActive.has(row.id)) this.stmt.markPlayerLeft.run({ id: row.id, gameId: game.id, now: game.updatedAt });
    }
    for (const player of game.players) {
      this.stmt.updatePlayer.run({
        id: player.id,
        gameId: game.id,
        position: player.position,
        isHost: bool(player.isHost),
        isConnected: bool(player.isConnected),
        isReady: bool(player.isReady),
        updatedAt: game.updatedAt,
      });
    }
    this.stmt.updateGame.run(this.gameParams(game));
  }

  insertMove(gameId: string, round: number, move: MoveResult, createdAt: string): void {
    this.stmt.insertMove.run({
      gameId,
      round,
      playerId: move.playerId,
      turnNumber: move.turnNumber,
      diceValue: move.diceValue,
      startPosition: move.startPosition,
      endPosition: move.endPosition,
      finalPosition: move.finalPosition,
      jump: move.jump,
      blocked: bool(move.blocked),
      bounced: bool(move.bounced),
      createdAt,
    });
  }

  /** Most recent moves of a round, newest first. */
  recentMoves(gameId: string, round: number, limit: number, boardSize: number): MoveLogEntry[] {
    return (this.stmt.recentMoves.all(gameId, round, limit) as MoveRow[]).map((row) => toMove(row, boardSize));
  }

  /** Full history of a game across all rounds, oldest first. */
  allMoves(gameId: string, boardSize: number): MoveLogEntry[] {
    return (this.stmt.allMoves.all(gameId) as MoveRow[]).map((row) => toMove(row, boardSize));
  }

  credentials(playerId: string): PlayerCredentials | null {
    const row = this.stmt.credentials.get(playerId) as
      | { game_id: string; token_hash: string; left_at: string | null }
      | undefined;
    return row ? { gameId: row.game_id, tokenHash: row.token_hash, hasLeft: row.left_at !== null } : null;
  }

  /** On boot nobody is connected yet; clear stale flags from a previous process. */
  markAllDisconnected(): void {
    this.stmt.markAllDisconnected.run();
  }

  private gameParams(game: Game) {
    return {
      id: game.id,
      status: game.status,
      currentPlayerId: game.currentPlayerId,
      winnerId: game.winnerId,
      turnNumber: game.turnNumber,
      round: game.round,
      startsAt: game.startsAt,
      updatedAt: game.updatedAt,
    };
  }
}

function toMove(row: MoveRow, boardSize: number): MoveLogEntry {
  return {
    id: row.id,
    playerId: row.player_id,
    diceValue: row.dice_value,
    startPosition: row.start_position,
    endPosition: row.end_position,
    finalPosition: row.final_position,
    jump: row.jump,
    blocked: row.blocked === 1,
    bounced: row.bounced === 1,
    won: row.final_position === boardSize,
    turnNumber: row.turn_number,
    createdAt: row.created_at,
  };
}

function stripLogFields(entry: MoveLogEntry): MoveResult {
  const { id: _id, createdAt: _createdAt, ...move } = entry;
  return move;
}
