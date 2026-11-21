import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithContext } from '../core/logger/request-context';

/** Gives every request a correlation id (or keeps the caller's) and returns it in the response header. */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-correlation-id', id);
  runWithContext(id, () => next());
}
