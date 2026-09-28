import { createApp } from './app';
import { loadConfig } from './config';
import { logger } from './logger';

const config = loadConfig();
const app = createApp(config);

app.server.listen(config.port, config.host, () => {
  logger.info(`Snakes & Ladders server listening on http://localhost:${config.port}`);
  logger.info(`SQLite database: ${config.dbPath}`);
});

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
