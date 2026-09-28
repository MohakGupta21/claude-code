import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string for a role allowed to create and drop the per-test databases. */
    adminDatabaseUrl: string;
  }
}

/**
 * Starts a throwaway PostgreSQL server for the test run. Set TEST_DATABASE_URL to use an
 * existing server instead (the role must be allowed to CREATE DATABASE).
 */
export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    project.provide('adminDatabaseUrl', external);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'snl-pg-'));
  const port = await freePort();
  const password = 'postgres';
  const server = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'),
    port,
    user: 'postgres',
    password,
    persistent: false,
    onLog: () => undefined,
  });
  await server.initialise();
  await server.start();
  project.provide('adminDatabaseUrl', `postgres://postgres:${password}@127.0.0.1:${port}/postgres`);

  return async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}
