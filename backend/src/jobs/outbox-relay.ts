import { OutboxEvent } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Logger } from '../core/logger/logger';
import { OutboxDatabaseService } from '../database';
import { REALTIME_CHANNEL } from '../realtime/realtime.service';

/**
 * Moves committed events from the outbox table to:
 *  - the `domain-events` queue (jobId = event id, so a re-send is ignored), and
 *  - the realtime Redis channel (browsers refresh).
 * Polls every 500 ms; loops immediately while there is a backlog.
 */
export class OutboxRelay {
  private logger = new Logger(this.constructor.name);
  private running = false;
  private stopped: Promise<void> = Promise.resolve();

  constructor(
    private readonly outboxDatabaseService: OutboxDatabaseService,
    private readonly domainEventsQueue: Queue,
    private readonly publisher: Redis,
  ) {}

  start() {
    this.running = true;
    this.stopped = this.loop();
  }

  async stop() {
    this.running = false;
    await this.stopped;
  }

  /** Relays one batch of events. Returns how many were sent. Exposed for tests. */
  relayOnce(limit = 100): Promise<number> {
    return this.outboxDatabaseService.relayBatch(limit, async (events: OutboxEvent[]) => {
      for (const event of events) {
        const message = {
          id: event.id,
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          correlationId: event.correlationId,
        };
        await this.domainEventsQueue.add(event.type, message, { jobId: event.id });
        await this.publisher.publish(REALTIME_CHANNEL, JSON.stringify(message)).catch(() => undefined);
      }
    });
  }

  private async loop() {
    while (this.running) {
      try {
        const sent = await this.relayOnce();
        if (sent > 0) continue; // backlog: go again straight away
      } catch (err) {
        this.logger.error(`[OutboxRelay] Relay failed, will retry: ${(err as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
