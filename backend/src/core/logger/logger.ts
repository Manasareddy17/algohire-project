import pino from 'pino';
import { getCorrelationId } from './request-context';

const rootLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'certiflow' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Personal data must never end up in logs.
  redact: ['*.phone', '*.name', '*.candidateName', 'req.headers.authorization'],
});

/** Mirrors the NestJS `new Logger(this.constructor.name)` usage, backed by pino JSON logs. */
export class Logger {
  private readonly logger: pino.Logger;

  constructor(context: string) {
    this.logger = rootLogger.child({ context });
  }

  private meta(extra?: object) {
    return { correlationId: getCorrelationId(), ...extra };
  }

  debug(message: string, extra?: object) {
    this.logger.debug(this.meta(extra), message);
  }

  log(message: string, extra?: object) {
    this.logger.info(this.meta(extra), message);
  }

  warn(message: string, extra?: object) {
    this.logger.warn(this.meta(extra), message);
  }

  error(message: string, extra?: object) {
    this.logger.error(this.meta(extra), message);
  }
}
