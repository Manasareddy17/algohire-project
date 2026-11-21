import { BatchStatus, Role } from '@prisma/client';
import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { BatchDatabaseService, BatchReviewDatabaseService } from '../../../database';
import { BatchWorkflowService } from '../../services/batch-workflow.service';
import { FetchPendingReviewsQuery } from '../impl';
import { batchScopeFor } from './fetch-batches.handler';

const STATUS_BY_ROLE: Partial<Record<Role, BatchStatus>> = {
  [Role.DISTRICT_OFFICER]: BatchStatus.DISTRICT_REVIEW,
  [Role.QUALITY]: BatchStatus.QUALITY_REVIEW,
  [Role.STATE]: BatchStatus.STATE_REVIEW,
};

@QueryHandler(FetchPendingReviewsQuery)
export class FetchPendingReviewsHandler implements IQueryHandler<FetchPendingReviewsQuery> {
  constructor(
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly batchReviewDatabaseService: BatchReviewDatabaseService,
    private readonly batchWorkflowService: BatchWorkflowService,
  ) {}

  async execute(query: FetchPendingReviewsQuery) {
    const { user } = query;
    const status = STATUS_BY_ROLE[user.role];
    if (!status) return [];

    const batches = await this.batchDatabaseService.fetchBatches({ ...batchScopeFor(user), status });
    const stage = this.batchWorkflowService.stageForStatus(status)!;

    // Hide batches this user already reviewed in their current revision.
    const pending = [];
    for (const batch of batches) {
      const mine = await this.batchReviewDatabaseService.fetchReviewByReviewer(batch.id, batch.revision, stage, user.id);
      if (!mine) pending.push(batch);
    }
    return pending;
  }
}
