import { resolve } from 'node:path';

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. See README.md for configuration.`);
  return value;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** PostgreSQL connection string, e.g. postgres://user:pass@host:5432/db?sslmode=require */
  databaseUrl: string;
  databasePoolMax: number;
  clientDir: string;
  /** How long a disconnected player keeps their lobby seat / turn before being removed / skipped. */
  reconnectGraceMs: number;
  /** Countdown between the host pressing Start and the first turn. */
  startCountdownMs: number;
  heartbeatMs: number;
}

/** Loads variables from ./.env if present. Variables already set in the environment win. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function loadConfig(): ServerConfig {
  loadDotEnv();
  return {
    port: intFromEnv('PORT', 3000),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: requireEnv('DATABASE_URL'),
    databasePoolMax: intFromEnv('DATABASE_POOL_MAX', 10),
    clientDir: resolve('dist/client'),
    reconnectGraceMs: intFromEnv('RECONNECT_GRACE_MS', 30_000),
    startCountdownMs: intFromEnv('START_COUNTDOWN_MS', 3_000),
    heartbeatMs: intFromEnv('HEARTBEAT_MS', 15_000),
  };
}
