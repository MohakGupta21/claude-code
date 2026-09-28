type Level = 'info' | 'warn' | 'error';

function log(level: Level, message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (detail === undefined) out(line);
  else out(line, detail);
}

export const logger = {
  info: (message: string, detail?: unknown) => log('info', message, detail),
  warn: (message: string, detail?: unknown) => log('warn', message, detail),
  error: (message: string, detail?: unknown) => log('error', message, detail),
};
