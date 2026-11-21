import { Logger } from '../logger/logger';
import { getCommandFor } from './decorators';
import { ICommandHandler } from './interfaces';

export class CommandBus {
  private readonly logger = new Logger(this.constructor.name);
  private readonly handlers = new Map<Function, ICommandHandler<object>>();

  register(...handlers: ICommandHandler<object>[]) {
    for (const handler of handlers) {
      const command = getCommandFor(handler.constructor);
      if (!command) {
        throw new Error(`${handler.constructor.name} is missing @CommandHandler()`);
      }
      this.handlers.set(command, handler);
    }
  }

  async execute<TResult = unknown>(command: object): Promise<TResult> {
    const handler = this.handlers.get(command.constructor);
    if (!handler) {
      throw new Error(`No handler registered for ${command.constructor.name}`);
    }
    this.logger.debug(`[CommandBus] Executing ${command.constructor.name}`);
    return handler.execute(command) as Promise<TResult>;
  }
}
