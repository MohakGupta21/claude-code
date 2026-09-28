import { resolve } from 'node:path';

function intFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  clientDir: string;
  /** How long a disconnected player keeps their lobby seat / turn before being removed / skipped. */
  reconnectGraceMs: number;
  /** Countdown between the host pressing Start and the first turn. */
  startCountdownMs: number;
  heartbeatMs: number;
}

export function loadConfig(): ServerConfig {
  return {
    port: intFromEnv('PORT', 3000),
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: resolve(process.env.DB_PATH ?? 'data/snakes.db'),
    clientDir: resolve('dist/client'),
    reconnectGraceMs: intFromEnv('RECONNECT_GRACE_MS', 30_000),
    startCountdownMs: intFromEnv('START_COUNTDOWN_MS', 3_000),
    heartbeatMs: intFromEnv('HEARTBEAT_MS', 15_000),
  };
}
