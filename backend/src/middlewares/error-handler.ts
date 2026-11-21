import { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { HttpException } from '../core/exceptions';
import { Logger } from '../core/logger/logger';
import { getCorrelationId } from '../core/logger/request-context';

const logger = new Logger('ErrorHandler');

/** Turns thrown exceptions into JSON responses. Unknown errors become a 500 without internals. */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const correlationId = getCorrelationId();

  if (err instanceof HttpException) {
    res.status(err.status).json({
      statusCode: err.status,
      message: err.message,
      ...(err.details ? (err.details as object) : {}),
      correlationId,
    });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({ statusCode: 400, message: `Upload error: ${err.message}`, correlationId });
    return;
  }

  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ statusCode: 400, message: 'Malformed JSON body', correlationId });
    return;
  }

  logger.error(`[${req.method} ${req.path}] Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ statusCode: 500, message: 'Something went wrong', correlationId });
}
