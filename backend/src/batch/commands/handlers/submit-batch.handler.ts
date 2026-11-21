import { BatchStatus } from '@prisma/client';
import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { ActionType, AuditAction, Modules } from '../../../core/enums/value.enum';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, BatchDatabaseService, CandidateDatabaseService, DataSource } from '../../../database';
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
    private readonly candidateDatabaseService: CandidateDatabaseService,
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

      // Same person in two submitted batches of one course = two certificates later. Two drafts
      // can hold the same people, so check again here. The course-level lock makes two submits
      // of the same course wait for each other, so both cannot pass this check at once.
      await manager.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${batch.courseCode}))`;
      const candidates = await this.candidateDatabaseService.fetchCandidatesByBatch(batchId, manager);
      const inOtherBatches = await this.candidateDatabaseService.fetchEnrolmentsInOtherActiveBatches(
        batch.courseCode,
        candidates.map((candidate) => candidate.enrolmentId),
        batchId,
        manager,
      );
      if (inOtherBatches.size > 0) {
        throw new UnprocessableEntityException('Some candidates are already in another batch for this course', {
          errors: candidates
            .filter((candidate) => inOtherBatches.has(candidate.enrolmentId))
            .map((candidate) => {
              const other = inOtherBatches.get(candidate.enrolmentId)!;
              return {
                row: candidate.rowNumber,
                column: 'enrolment_id',
                message: `Already in batch ${other.code} (${other.status}) for this course`,
              };
            }),
        });
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
