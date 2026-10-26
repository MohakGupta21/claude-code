import { DICE_MAX, DICE_MIN, GAME_STATUS } from '../../shared/constants';
import { withTransaction, type Database } from './database';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const statuses = Object.values(GAME_STATUS)
  .map((s) => `'${s}'`)
  .join(', ');

/** Arbitrary key for the advisory lock that stops two server processes migrating at once. */
const MIGRATION_LOCK_KEY = 7_021_553;

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
        current_player_id TEXT,
        winner_id         TEXT,
        turn_number       INTEGER NOT NULL DEFAULT 0,
        round             INTEGER NOT NULL DEFAULT 1,
        starts_at         TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL,
        updated_at        TIMESTAMPTZ NOT NULL
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
        is_host      BOOLEAN NOT NULL DEFAULT FALSE,
        is_connected BOOLEAN NOT NULL DEFAULT FALSE,
        is_ready     BOOLEAN NOT NULL DEFAULT FALSE,
        token_hash   TEXT NOT NULL,
        left_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX idx_players_game_id ON players(game_id);

      ALTER TABLE games
        ADD CONSTRAINT fk_games_current_player FOREIGN KEY (current_player_id) REFERENCES players(id) ON DELETE SET NULL,
        ADD CONSTRAINT fk_games_winner FOREIGN KEY (winner_id) REFERENCES players(id) ON DELETE SET NULL;

      CREATE TABLE moves (
        id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        game_id        TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        round          INTEGER NOT NULL,
        turn_number    INTEGER NOT NULL,
        dice_value     INTEGER NOT NULL CHECK (dice_value BETWEEN ${DICE_MIN} AND ${DICE_MAX}),
        start_position INTEGER NOT NULL,
        end_position   INTEGER NOT NULL,
        final_position INTEGER NOT NULL,
        jump           TEXT CHECK (jump IN ('snake', 'ladder')),
        blocked        BOOLEAN NOT NULL DEFAULT FALSE,
        bounced        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX idx_moves_game_id ON moves(game_id, round, id);
      CREATE INDEX idx_moves_player_id ON moves(player_id);
    `,
  },
  {
    version: 2,
    name: 'extra_turn_rule',
    sql: `
      ALTER TABLE games
        ADD COLUMN extra_turn_on INTEGER DEFAULT ${DICE_MAX} CHECK (extra_turn_on BETWEEN ${DICE_MIN} AND ${DICE_MAX});
      ALTER TABLE moves ADD COLUMN extra_turn BOOLEAN NOT NULL DEFAULT FALSE;
    `,
  },
];

/** Applies pending migrations in one transaction. Returns the versions that ran. */
export function runMigrations(db: Database): Promise<number[]> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.version));
    const ran: number[] = [];
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
      ran.push(migration.version);
    }
    return ran;
  });
}
