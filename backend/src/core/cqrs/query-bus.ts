import { Logger } from '../logger/logger';
import { getQueryFor } from './decorators';
import { IQueryHandler } from './interfaces';

export class QueryBus {
  private readonly logger = new Logger(this.constructor.name);
  private readonly handlers = new Map<Function, IQueryHandler<object>>();

  register(...handlers: IQueryHandler<object>[]) {
    for (const handler of handlers) {
      const query = getQueryFor(handler.constructor);
      if (!query) {
        throw new Error(`${handler.constructor.name} is missing @QueryHandler()`);
      }
      this.handlers.set(query, handler);
    }
  }

  async execute<TResult = unknown>(query: object): Promise<TResult> {
    const handler = this.handlers.get(query.constructor);
    if (!handler) {
      throw new Error(`No handler registered for ${query.constructor.name}`);
    }
    this.logger.debug(`[QueryBus] Executing ${query.constructor.name}`);
    return handler.execute(query) as Promise<TResult>;
  }
}
