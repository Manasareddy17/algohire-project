import { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { TooManyRequestsException } from '../core/exceptions';

/**
 * Fixed-window limit per IP, counted in Redis so it holds across all API instances.
 * If Redis is unavailable we let the request through (verification must keep working).
 */
export function rateLimit(redis: Redis, name: string, limitPerMinute: number) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const key = `ratelimit:${name}:${req.ip}:${Math.floor(Date.now() / 60_000)}`;
    let count = 0;
    try {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
    } catch {
      return next();
    }
    if (count > limitPerMinute) throw new TooManyRequestsException('Too many requests, try again in a minute');
    next();
  };
}
