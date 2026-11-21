import { Queue } from 'bullmq';
import { EventsHandler, IDomainEvent, IEventHandler } from '../../../core/cqrs';
import { CertificateIssuedEvent } from '../../events/impl/certificate.events';

/**
 * certificate.issued -> put one delivery job on the queue.
 * jobId = certificate id: if this event is handled twice, BullMQ keeps a single job.
 */
@EventsHandler(CertificateIssuedEvent)
export class CertificateIssuedHandler implements IEventHandler {
  constructor(
    private readonly deliveryQueue: Queue,
    private readonly maxAttempts: number,
  ) {}

  async handle(event: IDomainEvent) {
    await this.deliveryQueue.add(
      'deliver',
      { certificateId: event.aggregateId, correlationId: event.correlationId },
      {
        jobId: `deliver-${event.aggregateId}`,
        attempts: this.maxAttempts,
        backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s ...
      },
    );
  }
}
