import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { AuditAction } from '../../../core/enums/value.enum';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, BatchDatabaseService, DataSource } from '../../../database';
import { BatchEscalatedEvent, toBatchEventPayload } from '../../events/impl/batch.events';
import { EscalateStuckBatchesCommand } from '../impl/escalate-stuck-batches.command';

/**
 * Moment 5 of the brief: "A batch sits untouched with an officer for too long.
 * Someone senior finds out without anyone having to chase it."
 *
 * The worker runs this every minute. A batch that has been in the same review stage
 * longer than SLA_MINUTES is marked escalated, and a `batch.escalated` event goes to the
 * state office dashboard. `markEscalated` only updates rows where escalated_at IS NULL,
 * so if two workers run the scan at once, each batch is still escalated exactly once.
 */
@CommandHandler(EscalateStuckBatchesCommand)
export class EscalateStuckBatchesHandler implements ICommandHandler<EscalateStuckBatchesCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly eventBus: EventBus,
    private readonly slaMinutes: number,
  ) {}

  async execute(command: EscalateStuckBatchesCommand) {
    const stuckBefore = new Date(command.now.getTime() - this.slaMinutes * 60_000);
    const stuckBatches = (await this.batchDatabaseService.fetchStuckBatches(stuckBefore)).filter(
      (batch) => batch.escalatedAt === null,
    );

    let escalated = 0;
    for (const batch of stuckBatches) {
      // One small transaction per batch: one failure does not undo the others.
      const didEscalate = await this.dataSource.transaction(async (manager) => {
        const { count } = await this.batchDatabaseService.markEscalated(batch.id, batch.stageEnteredAt, manager);
        if (count === 0) return false; // someone else escalated it, or the batch moved on

        const waitingMinutes = Math.round((command.now.getTime() - batch.stageEnteredAt.getTime()) / 60_000);
        await this.auditLogDatabaseService.record(
          {
            actor: null,
            action: AuditAction.BatchEscalated,
            entityType: 'Batch',
            entityId: batch.id,
            batchId: batch.id,
            metadata: { status: batch.status, waitingMinutes, slaMinutes: this.slaMinutes },
          },
          manager,
        );
        await this.eventBus.publish(
          manager,
          BatchEscalatedEvent,
          batch.id,
          toBatchEventPayload(batch, batch.status, batch.revision, { waitingMinutes }),
        );
        return true;
      });
      if (didEscalate) escalated++;
    }

    if (escalated > 0) this.logger.warn(`[EscalateStuckBatches] Escalated ${escalated} batch(es)`);
    return { escalated };
  }
}
