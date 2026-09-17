import { pino, type Logger, type LoggerOptions } from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

const baseOptions: LoggerOptions = {
  level: logLevel,
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const rootLogger: Logger = pino(baseOptions);

export type { Logger } from 'pino';

export function createLogger(name: string, defaultMeta?: Record<string, unknown>): Logger {
  return rootLogger.child({
    service: name,
    ...defaultMeta,
  });
}
