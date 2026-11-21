import { CommandBus, EventsHandler, IDomainEvent, IEventHandler } from '../../../core/cqrs';
import { BatchApprovedEvent } from '../../../batch/events/impl/batch.events';
import { IssueBatchCertificatesCommand } from '../../commands/impl';

/** batch.approved -> issue one certificate per candidate. Runs in the worker. */
@EventsHandler(BatchApprovedEvent)
export class BatchApprovedHandler implements IEventHandler {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: IDomainEvent) {
    await this.commandBus.execute(new IssueBatchCertificatesCommand(event.aggregateId));
  }
}
