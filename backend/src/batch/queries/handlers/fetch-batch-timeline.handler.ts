import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { NotFoundException } from '../../../core/exceptions';
import { AuditLogDatabaseService, BatchDatabaseService } from '../../../database';
import { BatchWorkflowService } from '../../services/batch-workflow.service';
import { FetchBatchTimelineQuery } from '../impl';

/** Observability: everything that happened to one batch, who did it and when, in order. */
@QueryHandler(FetchBatchTimelineQuery)
export class FetchBatchTimelineHandler implements IQueryHandler<FetchBatchTimelineQuery> {
  constructor(
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly batchWorkflowService: BatchWorkflowService,
  ) {}

  async execute(query: FetchBatchTimelineQuery) {
    const { batchId, user } = query;
    const batch = await this.batchDatabaseService.fetchBatchById(batchId);
    if (!batch || !this.batchWorkflowService.canView(user, batch)) {
      throw new NotFoundException('Batch not found');
    }
    return this.auditLogDatabaseService.fetchBatchTimeline(batchId);
  }
}
