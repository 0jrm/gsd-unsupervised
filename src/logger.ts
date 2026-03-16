import pino, { type Logger } from 'pino';

export type { Logger } from 'pino';

export function createLogger(options: {
  level?: string;
  pretty?: boolean;
}): Logger {
  const { level = 'info', pretty = false } = options;

  if (pretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
        },
      },
    });
  }

  return pino({ level });
}

export function createChildLogger(parent: Logger, component: string): Logger {
  return parent.child({ component });
}

let defaultLogger: Logger | undefined;

export function initLogger(options: {
  level?: string;
  pretty?: boolean;
}): Logger {
  defaultLogger = createLogger(options);
  return defaultLogger;
}

export function getLogger(): Logger {
  if (!defaultLogger) {
    throw new Error('Logger not initialized — call initLogger() first');
  }
  return defaultLogger;
}
