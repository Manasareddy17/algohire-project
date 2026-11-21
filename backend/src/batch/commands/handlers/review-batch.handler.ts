import { BatchStatus, Prisma, ReviewDecision } from '@prisma/client';
import { CommandHandler, EventBus, EventType, ICommandHandler } from '../../../core/cqrs';
import { ActionType, AuditAction, Modules } from '../../../core/enums/value.enum';
import { ConflictException, NotFoundException } from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import {
  AuditLogDatabaseService,
  BatchDatabaseService,
  BatchReviewDatabaseService,
  DataSource,
} from '../../../database';
import { buildResponse } from '../../../utils/response-messages.util';
import {
  BatchApprovedEvent,
  BatchRejectedEvent,
  BatchReviewedEvent,
  BatchSentBackEvent,
  BatchStageChangedEvent,
  toBatchEventPayload,
} from '../../events/impl/batch.events';
import { BatchWorkflowService } from '../../services/batch-workflow.service';
import { ReviewBatchCommand } from '../impl/review-batch.command';

const ACTION_BY_DECISION: Record<ReviewDecision, ActionType> = {
  APPROVE: ActionType.Approved,
  SEND_BACK: ActionType.SentBack,
  REJECT: ActionType.Rejected,
};

/**
 * Approve / send back / reject a batch at the current stage.
 *
 * Moment 2 of the brief: "Two district officers approve the same batch at the same moment.
 * The batch moves forward once, not twice." Three things make that true:
 *  1. `lockBatchForUpdate` (SELECT ... FOR UPDATE): the second officer's transaction waits
 *     until the first one commits, then reads the updated batch;
 *  2. the status check inside the lock: if the batch already moved on, the late request
 *     gets 409 instead of moving it again;
 *  3. the unique key (batch, revision, stage, reviewer) on batch_reviews: the same officer
 *     can never be counted twice, even with a replayed request.
 */
@CommandHandler(ReviewBatchCommand)
export class ReviewBatchHandler implements ICommandHandler<ReviewBatchCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly batchReviewDatabaseService: BatchReviewDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly batchWorkflowService: BatchWorkflowService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ReviewBatchCommand) {
    const { batchId, reviewRequest, user } = command;
    const { decision, reason, revision } = reviewRequest;
    this.logger.debug(`[ReviewBatch] batchId: ${batchId}, userId: ${user.id}, decision: ${decision}`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // 1. Lock the batch row. A concurrent review of the same batch waits here.
        const batch = await this.batchDatabaseService.lockBatchForUpdate(batchId, manager);
        if (!batch) throw new NotFoundException('Batch not found');

        // 2. Is the batch waiting for a review, and is it the version the officer looked at?
        const stage = this.batchWorkflowService.stageForStatus(batch.status);
        if (!stage) {
          throw new ConflictException(`This batch is not waiting for a review (now: ${batch.status})`);
        }
        if (batch.revision !== revision) {
          throw new ConflictException('The batch was changed since you opened it. Reload and review again.');
        }

        // 3. Is this user allowed to act at this stage (right role, right district)?
        this.batchWorkflowService.assertCanReview(user, batch, stage);

        const existing = await this.batchReviewDatabaseService.fetchReviewByReviewer(
          batchId, revision, stage, user.id, manager,
        );
        if (existing) {
          throw new ConflictException(`You already reviewed this batch (${existing.decision})`);
        }

        // 4. Record this reviewer's decision.
        await this.batchReviewDatabaseService.createReview(
          { batchId, revision, stage, reviewerId: user.id, decision, reason },
          manager,
        );
        await this.auditLogDatabaseService.record(
          {
            actor: user,
            action: AuditAction.BatchReviewed,
            entityType: 'Batch',
            entityId: batchId,
            batchId,
            metadata: { stage, decision, reason, revision },
          },
          manager,
        );

        // 5. Enough matching decisions to move the batch? (district: 2 officers, others: 1)
        const required = this.batchWorkflowService.decisionsRequired(stage);
        const count = this.batchWorkflowService.isImmediate(decision)
          ? required
          : await this.batchReviewDatabaseService.countDecisions(batchId, revision, stage, decision, manager);

        if (count < required) {
          await this.eventBus.publish(
            manager,
            BatchReviewedEvent,
            batchId,
            toBatchEventPayload(batch, batch.status, revision, { stage, decision, count, required }),
          );
          return { status: batch.status, stage, count, required };
        }

        // 6. Move the batch to its next status.
        const nextStatus = this.batchWorkflowService.statusAfterDecision(stage, decision, batch._count.candidates);
        await this.batchDatabaseService.updateBatch(
          batchId,
          {
            status: nextStatus,
            stageEnteredAt: new Date(),
            escalatedAt: null,
            sendBackReason: decision === ReviewDecision.SEND_BACK ? reason : undefined,
            approvedAt: nextStatus === BatchStatus.APPROVED ? new Date() : undefined,
          },
          manager,
        );
        await this.auditLogDatabaseService.record(
          {
            actor: user,
            action: AuditAction.BatchStageChanged,
            entityType: 'Batch',
            entityId: batchId,
            batchId,
            metadata: { from: batch.status, to: nextStatus, revision },
          },
          manager,
        );
        await this.eventBus.publish(
          manager,
          this.eventFor(nextStatus),
          batchId,
          toBatchEventPayload(batch, nextStatus, revision, { from: batch.status, reason }),
        );

        return { status: nextStatus, stage, count, required };
      });

      this.logger.log(`[ReviewBatch] ${decision} recorded - batchId: ${batchId}, status: ${result.status}`);
      return buildResponse(Modules.Batch, batchId, ACTION_BY_DECISION[decision], result);
    } catch (err) {
      // Unique key on batch_reviews: last line of defence against a double review.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You already reviewed this batch');
      }
      this.logger.error(`[ReviewBatch] Failed - batchId: ${batchId}: ${(err as Error).message}`);
      throw err;
    }
  }

  private eventFor(status: BatchStatus): EventType {
    switch (status) {
      case BatchStatus.APPROVED:
        return BatchApprovedEvent;
      case BatchStatus.SENT_BACK:
        return BatchSentBackEvent;
      case BatchStatus.REJECTED:
        return BatchRejectedEvent;
      default:
        return BatchStageChangedEvent;
    }
  }
}
