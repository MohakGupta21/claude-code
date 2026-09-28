import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/** Creates an empty, uniquely named database so every test starts from a clean schema. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('adminDatabaseUrl');
  const name = `snl_test_${randomBytes(6).toString('hex')}`;
  await adminQuery(adminUrl, `CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () => adminQuery(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  };
}

async function adminQuery(adminUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
