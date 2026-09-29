// Runs the API/WebSocket server and the Vite dev server together.
// Reads .env if present. If DATABASE_URL is still not set, starts a local embedded PostgreSQL whose data lives in
// data/postgres, so games survive dev restarts.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const DEV_PG_DIR = resolve('data/postgres');
const DEV_PG_USER = 'postgres';
const DEV_PG_PASSWORD = 'postgres';

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let embedded = null;
if (!process.env.DATABASE_URL?.trim()) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  embedded = new EmbeddedPostgres({
    databaseDir: DEV_PG_DIR,
    port,
    user: DEV_PG_USER,
    password: DEV_PG_PASSWORD,
    persistent: true,
    onLog: () => undefined,
  });
  if (!existsSync(resolve(DEV_PG_DIR, 'PG_VERSION'))) await embedded.initialise();
  // Postgres refuses to start unless its data directory is private to the owner.
  chmodSync(DEV_PG_DIR, 0o700);
  await embedded.start();
  process.env.DATABASE_URL = `postgres://${DEV_PG_USER}:${DEV_PG_PASSWORD}@127.0.0.1:${port}/postgres`;
  console.log(`DATABASE_URL not set; using embedded PostgreSQL in ${DEV_PG_DIR} (port ${port})`);
}

const procs = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev:client'], { stdio: 'inherit' }),
];

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) p.kill('SIGTERM');
  if (embedded) await embedded.stop().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const p of procs) p.on('exit', (code) => code && shutdown());

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}
