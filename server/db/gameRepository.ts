import { getBoard } from '../../shared/boards';
import type { FinishRule, GameStatus, PlayerColor } from '../../shared/constants';
import type { JumpKind, MoveLogEntry, MoveResult } from '../../shared/types';
import type { Game, Player } from '../engine/model';
import { withTransaction, type Database, type Queryable } from './database';

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
  starts_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PlayerRow {
  id: string;
  game_id: string;
  name: string;
  color: PlayerColor;
  position: number;
  turn_order: number;
  is_host: boolean;
  is_connected: boolean;
  is_ready: boolean;
  created_at: Date;
}

interface MoveRow {
  id: string; // BIGINT arrives as a string
  player_id: string;
  turn_number: number;
  dice_value: number;
  start_position: number;
  end_position: number;
  final_position: number;
  jump: JumpKind | null;
  blocked: boolean;
  bounced: boolean;
  created_at: Date;
}

export interface PlayerCredentials {
  gameId: string;
  tokenHash: string;
  hasLeft: boolean;
}

export interface FindOptions {
  /** Take a row lock on the game so concurrent actions on the same room run one after another. */
  forUpdate?: boolean;
}

const toPlayer = (row: PlayerRow): Player => ({
  id: row.id,
  name: row.name,
  color: row.color,
  position: row.position,
  isHost: row.is_host,
  isConnected: row.is_connected,
  isReady: row.is_ready,
  turnOrder: row.turn_order,
  joinedAt: row.created_at.toISOString(),
});

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const ACTIVE_PLAYERS_SQL = 'SELECT * FROM players WHERE game_id = $1 AND left_at IS NULL ORDER BY turn_order';

/**
 * All SQL for games, players and moves. Every query is parameterised.
 * Multi-statement changes go through `transaction`, which hands the callback a repository
 * bound to a single connection.
 */
export class GameRepository {
  constructor(
    private readonly db: Queryable,
    private readonly pool: Database | null = null,
  ) {}

  static forPool(pool: Database): GameRepository {
    return new GameRepository(pool, pool);
  }

  transaction<T>(fn: (tx: GameRepository) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('Nested transactions are not supported');
    return withTransaction(this.pool, (client) => fn(new GameRepository(client)));
  }

  async roomCodeExists(roomCode: string): Promise<boolean> {
    const { rowCount } = await this.db.query('SELECT 1 FROM games WHERE room_code = $1', [roomCode]);
    return (rowCount ?? 0) > 0;
  }

  async insertGame(game: Game): Promise<void> {
    await this.db.query(
      `INSERT INTO games (id, room_code, status, board_id, finish_rule, current_player_id, winner_id,
                          turn_number, round, starts_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        game.id,
        game.roomCode,
        game.status,
        game.boardId,
        game.rules.finishRule,
        game.currentPlayerId,
        game.winnerId,
        game.turnNumber,
        game.round,
        game.startsAt,
        game.createdAt,
        game.updatedAt,
      ],
    );
  }

  async findByRoomCode(roomCode: string, { forUpdate = false }: FindOptions = {}): Promise<Game | null> {
    const { rows } = await this.db.query<GameRow>(
      `SELECT * FROM games WHERE room_code = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [roomCode],
    );
    const row = rows[0];
    if (!row) return null;
    const players = (await this.db.query<PlayerRow>(ACTIVE_PLAYERS_SQL, [row.id])).rows.map(toPlayer);
    const [lastMove] = await this.recentMoves(row.id, row.round, 1, getBoard(row.board_id).size);
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
      startsAt: iso(row.starts_at),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      players,
    };
  }

  async roomCodesWithStatus(status: GameStatus): Promise<string[]> {
    const { rows } = await this.db.query<{ room_code: string }>('SELECT room_code FROM games WHERE status = $1', [
      status,
    ]);
    return rows.map((r) => r.room_code);
  }

  async insertPlayer(gameId: string, player: Player, tokenHash: string): Promise<void> {
    await this.db.query(
      `INSERT INTO players (id, game_id, name, color, position, turn_order, is_host, is_connected, is_ready,
                            token_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        player.id,
        gameId,
        player.name,
        player.color,
        player.position,
        player.turnOrder,
        player.isHost,
        player.isConnected,
        player.isReady,
        tokenHash,
        player.joinedAt,
      ],
    );
  }

  /**
   * Persists a game produced by the engine: the game row, every active player, and marks
   * players that are no longer in the game as having left (their move history is kept).
   */
  async saveGame(game: Game): Promise<void> {
    await this.db.query(
      `UPDATE players SET left_at = $3, is_connected = FALSE, is_host = FALSE, updated_at = $3
       WHERE game_id = $1 AND left_at IS NULL AND NOT (id = ANY($2::text[]))`,
      [game.id, game.players.map((p) => p.id), game.updatedAt],
    );
    for (const player of game.players) {
      await this.db.query(
        `UPDATE players SET position = $3, is_host = $4, is_connected = $5, is_ready = $6, updated_at = $7
         WHERE id = $1 AND game_id = $2 AND left_at IS NULL`,
        [player.id, game.id, player.position, player.isHost, player.isConnected, player.isReady, game.updatedAt],
      );
    }
    await this.db.query(
      `UPDATE games SET status = $2, current_player_id = $3, winner_id = $4, turn_number = $5, round = $6,
                        starts_at = $7, updated_at = $8
       WHERE id = $1`,
      [game.id, game.status, game.currentPlayerId, game.winnerId, game.turnNumber, game.round, game.startsAt,
        game.updatedAt],
    );
  }

  async insertMove(gameId: string, round: number, move: MoveResult, createdAt: string): Promise<void> {
    await this.db.query(
      `INSERT INTO moves (game_id, player_id, round, turn_number, dice_value, start_position, end_position,
                          final_position, jump, blocked, bounced, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        gameId,
        move.playerId,
        round,
        move.turnNumber,
        move.diceValue,
        move.startPosition,
        move.endPosition,
        move.finalPosition,
        move.jump,
        move.blocked,
        move.bounced,
        createdAt,
      ],
    );
  }

  /** Most recent moves of a round, newest first. */
  async recentMoves(gameId: string, round: number, limit: number, boardSize: number): Promise<MoveLogEntry[]> {
    const { rows } = await this.db.query<MoveRow>(
      'SELECT * FROM moves WHERE game_id = $1 AND round = $2 ORDER BY id DESC LIMIT $3',
      [gameId, round, limit],
    );
    return rows.map((row) => toMove(row, boardSize));
  }

  /** Full history of a game across all rounds, oldest first. */
  async allMoves(gameId: string, boardSize: number): Promise<MoveLogEntry[]> {
    const { rows } = await this.db.query<MoveRow>('SELECT * FROM moves WHERE game_id = $1 ORDER BY id', [gameId]);
    return rows.map((row) => toMove(row, boardSize));
  }

  async credentials(playerId: string): Promise<PlayerCredentials | null> {
    const { rows } = await this.db.query<{ game_id: string; token_hash: string; left_at: Date | null }>(
      'SELECT game_id, token_hash, left_at FROM players WHERE id = $1',
      [playerId],
    );
    const row = rows[0];
    return row ? { gameId: row.game_id, tokenHash: row.token_hash, hasLeft: row.left_at !== null } : null;
  }

  /** On boot nobody is connected yet; clear stale flags from a previous process. */
  async markAllDisconnected(): Promise<void> {
    await this.db.query('UPDATE players SET is_connected = FALSE WHERE is_connected');
  }
}

function toMove(row: MoveRow, boardSize: number): MoveLogEntry {
  return {
    id: Number(row.id),
    playerId: row.player_id,
    diceValue: row.dice_value,
    startPosition: row.start_position,
    endPosition: row.end_position,
    finalPosition: row.final_position,
    jump: row.jump,
    blocked: row.blocked,
    bounced: row.bounced,
    won: row.final_position === boardSize,
    turnNumber: row.turn_number,
    createdAt: row.created_at.toISOString(),
  };
}

function stripLogFields(entry: MoveLogEntry): MoveResult {
  const { id: _id, createdAt: _createdAt, ...move } = entry;
  return move;
}
