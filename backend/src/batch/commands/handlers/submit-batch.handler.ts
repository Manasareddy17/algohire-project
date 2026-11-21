import { BatchStatus } from '@prisma/client';
import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { ActionType, AuditAction, Modules } from '../../../core/enums/value.enum';
import { BadRequestException, ConflictException, NotFoundException } from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, BatchDatabaseService, DataSource } from '../../../database';
import { buildResponse } from '../../../utils/response-messages.util';
import { BatchSubmittedEvent, toBatchEventPayload } from '../../events/impl/batch.events';
import { BatchWorkflowService } from '../../services/batch-workflow.service';
import { SubmitBatchCommand } from '../impl/submit-batch.command';

/**
 * Sends a DRAFT or SENT_BACK batch to the district officers.
 *
 * Moment 6 decision: resubmitting a sent-back batch increases `revision` by 1.
 * Reviews are stored per revision, so approvals given to the old version no longer count:
 * the candidate list may have changed, and an officer must not be counted as approving
 * data they never saw. The old reviews stay in the table for the audit trail.
 */
@CommandHandler(SubmitBatchCommand)
export class SubmitBatchHandler implements ICommandHandler<SubmitBatchCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly batchWorkflowService: BatchWorkflowService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: SubmitBatchCommand) {
    const { batchId, user } = command;
    this.logger.debug(`[SubmitBatch] batchId: ${batchId}, userId: ${user.id}`);

    const result = await this.dataSource.transaction(async (manager) => {
      // Row lock: a double click on "Submit" cannot submit twice.
      const batch = await this.batchDatabaseService.lockBatchForUpdate(batchId, manager);
      if (!batch) throw new NotFoundException('Batch not found');
      this.batchWorkflowService.assertCentreOwnsBatch(user, batch);

      if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.SENT_BACK) {
        throw new ConflictException(`Only a draft or sent-back batch can be submitted (now: ${batch.status})`);
      }
      if (batch._count.candidates === 0) {
        throw new BadRequestException('Upload candidates before submitting');
      }

      const revision = batch.status === BatchStatus.SENT_BACK ? batch.revision + 1 : batch.revision;
      const now = new Date();

      await this.batchDatabaseService.updateBatch(
        batchId,
        {
          status: BatchStatus.DISTRICT_REVIEW,
          revision,
          stageEnteredAt: now,
          escalatedAt: null,
          sendBackReason: null,
          submittedAt: now,
        },
        manager,
      );

      await this.auditLogDatabaseService.record(
        {
          actor: user,
          action: AuditAction.BatchSubmitted,
          entityType: 'Batch',
          entityId: batchId,
          batchId,
          metadata: { revision, resubmission: revision > 1, candidateCount: batch._count.candidates },
        },
        manager,
      );

      // Saved in the same transaction: if anything above fails, no event is sent either.
      await this.eventBus.publish(
        manager,
        BatchSubmittedEvent,
        batchId,
        toBatchEventPayload(batch, BatchStatus.DISTRICT_REVIEW, revision),
      );

      return { revision };
    });

    this.logger.log(`[SubmitBatch] Submitted - batchId: ${batchId}, revision: ${result.revision}`);
    return buildResponse(Modules.Batch, batchId, ActionType.Submitted, result);
  }
}
