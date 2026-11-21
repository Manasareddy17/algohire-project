import Redis from 'ioredis';
import { Logger } from '../logger/logger';

/**
 * Small Redis cache. Redis is only a speed-up here, never the source of truth:
 * if Redis is down, reads return null and callers fall back to Postgres.
 */
export class CacheService {
  private logger = new Logger(this.constructor.name);

  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (err) {
      this.logger.warn(`[Cache] get failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`[Cache] set failed for ${key}: ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`[Cache] del failed for ${key}: ${(err as Error).message}`);
    }
  }
}
