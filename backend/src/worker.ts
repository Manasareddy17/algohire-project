import { Queue, UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import { EscalateStuckBatchesCommand } from './batch/commands/impl';
import { DeliverCertificateCommand, MarkDeliveryFailedCommand } from './certificate/commands/impl';
import { buildContainer } from './container';
import { config } from './core/config';
import { IDomainEvent } from './core/cqrs';
import { Logger } from './core/logger/logger';
import { runWithContext } from './core/logger/request-context';
import { OutboxDatabaseService, prisma } from './database';
import { defaultJobOptions, QueueNames } from './jobs/queues';
import { OutboxRelay } from './jobs/outbox-relay';
import { WhatsAppError } from './notification/whatsapp/whatsapp.client';

const logger = new Logger('Worker');

/**
 * The worker does all the slow / unreliable work so users never wait for it:
 *  1. OutboxRelay: outbox table -> queue + realtime channel
 *  2. domain-events worker: runs event handlers (batch.approved -> issue certificates, ...)
 *  3. certificate-delivery worker: PDF + WhatsApp, with retries
 *  4. maintenance worker: SLA scan every minute
 * Any number of worker containers can run side by side (docker compose up --scale worker=3).
 */
async function bootstrap() {
  // BullMQ needs maxRetriesPerRequest: null so blocking commands wait for Redis to come back.
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = new Redis(config.REDIS_URL);

  const domainEventsQueue = new Queue(QueueNames.DomainEvents, { connection, defaultJobOptions });
  const deliveryQueue = new Queue(QueueNames.CertificateDelivery, { connection, defaultJobOptions });
  const maintenanceQueue = new Queue(QueueNames.Maintenance, { connection, defaultJobOptions });

  const { commandBus, eventBus } = buildContainer({ redis: publisher, deliveryQueue });

  const outboxRelay = new OutboxRelay(new OutboxDatabaseService(), domainEventsQueue, publisher);
  outboxRelay.start();

  const domainEventsWorker = new Worker(
    QueueNames.DomainEvents,
    (job) => {
      const event = job.data as IDomainEvent;
      return runWithContext(event.correlationId ?? undefined, () => eventBus.dispatch(event));
    },
    { connection, concurrency: 5 },
  );

  const deliveryWorker = new Worker(
    QueueNames.CertificateDelivery,
    (job) =>
      runWithContext(job.data.correlationId, async () => {
        try {
          return await commandBus.execute(new DeliverCertificateCommand(job.data.certificateId));
        } catch (err) {
          // Retrying will not help (e.g. invalid number): stop now instead of 8 attempts.
          if (err instanceof WhatsAppError && !err.retryable) throw new UnrecoverableError(err.message);
          throw err;
        }
      }),
    // concurrency = parallel WhatsApp calls per worker container; tune to the provider's rate limit.
    { connection, concurrency: 10 },
  );

  // Out of retries -> record FAILED so the state office sees it.
  deliveryWorker.on('failed', (job, err) => {
    if (!job) return;
    const outOfAttempts = job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError;
    if (outOfAttempts) {
      runWithContext(job.data.correlationId, () =>
        commandBus.execute(new MarkDeliveryFailedCommand(job.data.certificateId, err.message)),
      ).catch((markErr) => logger.error(`[Worker] Could not mark delivery failed: ${markErr.message}`));
    }
  });

  const maintenanceWorker = new Worker(
    QueueNames.Maintenance,
    () => runWithContext(undefined, () => commandBus.execute(new EscalateStuckBatchesCommand())),
    { connection, concurrency: 1 },
  );
  // One schedule shared by all workers: only one of them runs each tick.
  await maintenanceQueue.upsertJobScheduler('sla-scan', { every: 60_000 }, { name: 'sla-scan' });

  for (const worker of [domainEventsWorker, deliveryWorker, maintenanceWorker]) {
    worker.on('error', (err) => logger.error(`[Worker] ${worker.name}: ${err.message}`));
  }
  logger.log('Worker started');

  // On restart: finish the current jobs, stop relaying, then exit. Unfinished jobs are picked up again.
  const shutdown = async () => {
    logger.log('Shutting down worker');
    await outboxRelay.stop();
    await Promise.allSettled([domainEventsWorker.close(), deliveryWorker.close(), maintenanceWorker.close()]);
    await Promise.allSettled([prisma.$disconnect(), connection.quit(), publisher.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(`Worker failed to start: ${err.message}`);
  process.exit(1);
});
