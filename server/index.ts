import { createApp } from './app';
import { loadConfig } from './config';
import { logger } from './logger';

const config = (() => {
  try {
    return loadConfig();
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'Invalid configuration');
    process.exit(1);
  }
})();
const app = await createApp(config).catch((error: unknown) => {
  logger.error('Could not connect to the database', error);
  process.exit(1);
});

app.server.listen(config.port, config.host, () => {
  logger.info(`Snakes & Ladders server listening on http://localhost:${config.port}`);
  logger.info(`PostgreSQL database: ${redactPassword(config.databaseUrl)}`);
});

function redactPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => logger.error('Unhandled rejection', error));
