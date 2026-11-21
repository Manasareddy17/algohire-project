import { Prisma } from '@prisma/client';
import { getCorrelationId } from '../logger/request-context';
import { Logger } from '../logger/logger';
import { getEventsFor } from './decorators';
import { EventType, IDomainEvent, IEventHandler } from './interfaces';

/**
 * Publishing an event = inserting it into the outbox inside the caller's transaction.
 * The OutboxRelay (worker) later moves it to the queue, where `dispatch` runs the handlers.
 * So handlers only ever see events whose state change really committed.
 */
export class EventBus {
  private readonly logger = new Logger(this.constructor.name);
  private readonly handlers = new Map<string, IEventHandler[]>();

  register(...handlers: IEventHandler[]) {
    for (const handler of handlers) {
      for (const event of getEventsFor(handler.constructor)) {
        const list = this.handlers.get(event.type) ?? [];
        list.push(handler);
        this.handlers.set(event.type, list);
      }
    }
  }

  async publish(
    tx: Prisma.TransactionClient,
    event: EventType,
    aggregateId: string,
    payload: Record<string, unknown>,
  ) {
    await tx.outboxEvent.create({
      data: {
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId,
        payload: payload as Prisma.InputJsonValue,
        correlationId: getCorrelationId(),
      },
    });
  }

  async dispatch(event: IDomainEvent) {
    const handlers = this.handlers.get(event.type) ?? [];
    this.logger.debug(`[EventBus] Dispatching ${event.type} to ${handlers.length} handler(s)`, {
      eventId: event.id,
    });
    for (const handler of handlers) {
      await handler.handle(event);
    }
  }
}
