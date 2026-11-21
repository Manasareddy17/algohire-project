import { OutboxEvent } from '@prisma/client';
import { DataSource, dataSource as defaultDataSource } from './data-source';

export class OutboxDatabaseService {
  constructor(private readonly dataSource: DataSource = defaultDataSource) {}

  /**
   * Picks up to `limit` events that are not sent yet, hands them to `publish`,
   * then marks them as sent.
   *
   * All of it is one transaction:
   *  - if `publish` throws, the transaction rolls back and the events stay "not sent",
   *    so the next run sends them again (they are never lost);
   *  - FOR UPDATE SKIP LOCKED means two worker instances never pick the same events.
   */
  async relayBatch(limit: number, publish: (events: OutboxEvent[]) => Promise<void>): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const events = await manager.$queryRaw<OutboxEvent[]>`
        SELECT id, type, aggregate_type AS "aggregateType", aggregate_id AS "aggregateId",
               payload, correlation_id AS "correlationId", created_at AS "createdAt", published_at AS "publishedAt"
        FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;

      if (events.length === 0) return 0;

      await publish(events);

      await manager.outboxEvent.updateMany({
        where: { id: { in: events.map((event) => event.id) } },
        data: { publishedAt: new Date() },
      });
      return events.length;
    });
  }
}
