import type { Database } from 'better-sqlite3';
import { DICE_MAX, DICE_MIN, GAME_STATUS } from '../../shared/constants';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const statuses = Object.values(GAME_STATUS)
  .map((s) => `'${s}'`)
  .join(', ');

/**
 * Ordered, append-only schema migrations. Never edit a migration that has shipped;
 * add a new one instead.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE games (
        id                TEXT PRIMARY KEY,
        room_code         TEXT NOT NULL,
        status            TEXT NOT NULL CHECK (status IN (${statuses})),
        board_id          TEXT NOT NULL,
        finish_rule       TEXT NOT NULL,
        current_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
        winner_id         TEXT REFERENCES players(id) ON DELETE SET NULL,
        turn_number       INTEGER NOT NULL DEFAULT 0,
        round             INTEGER NOT NULL DEFAULT 1,
        starts_at         TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_games_room_code ON games(room_code);
      CREATE INDEX idx_games_status ON games(status);

      CREATE TABLE players (
        id           TEXT PRIMARY KEY,
        game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        color        TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0,
        turn_order   INTEGER NOT NULL,
        is_host      INTEGER NOT NULL DEFAULT 0 CHECK (is_host IN (0, 1)),
        is_connected INTEGER NOT NULL DEFAULT 0 CHECK (is_connected IN (0, 1)),
        is_ready     INTEGER NOT NULL DEFAULT 0 CHECK (is_ready IN (0, 1)),
        token_hash   TEXT NOT NULL,
        left_at      TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_players_game_id ON players(game_id);

      CREATE TABLE moves (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id        TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        round          INTEGER NOT NULL,
        turn_number    INTEGER NOT NULL,
        dice_value     INTEGER NOT NULL CHECK (dice_value BETWEEN ${DICE_MIN} AND ${DICE_MAX}),
        start_position INTEGER NOT NULL,
        end_position   INTEGER NOT NULL,
        final_position INTEGER NOT NULL,
        jump           TEXT CHECK (jump IN ('snake', 'ladder')),
        blocked        INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
        bounced        INTEGER NOT NULL DEFAULT 0 CHECK (bounced IN (0, 1)),
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_moves_game_id ON moves(game_id, round, id);
      CREATE INDEX idx_moves_player_id ON moves(player_id);
    `,
  },
];

export function runMigrations(db: Database): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    })();
    ran.push(migration.version);
  }
  return ran;
}
