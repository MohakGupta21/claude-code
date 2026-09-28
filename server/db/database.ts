import pg from 'pg';
import { logger } from '../logger';
import { runMigrations } from './migrations';

export type Database = pg.Pool;
/** Anything that can run a query: the pool, or a client checked out for a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface DatabaseOptions {
  connectionString: string;
  maxConnections?: number;
}

/** Connects to PostgreSQL and brings its schema up to date. */
export async function openDatabase({ connectionString, maxConnections }: DatabaseOptions): Promise<Database> {
  const pool = new pg.Pool({ connectionString, max: maxConnections });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on('error', (error) => logger.error('Idle database client error', error));
  try {
    await runMigrations(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return pool;
}

/** Runs `fn` inside BEGIN/COMMIT on a single client, rolling back if it throws. */
export async function withTransaction<T>(pool: Database, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
