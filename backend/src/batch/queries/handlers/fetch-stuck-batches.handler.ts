import { Role } from '@prisma/client';
import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { ForbiddenException } from '../../../core/exceptions';
import { BatchDatabaseService } from '../../../database';
import { FetchStuckBatchesQuery } from '../impl';

@QueryHandler(FetchStuckBatchesQuery)
export class FetchStuckBatchesHandler implements IQueryHandler<FetchStuckBatchesQuery> {
  constructor(
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly slaMinutes: number,
  ) {}

  async execute(query: FetchStuckBatchesQuery) {
    if (query.user.role !== Role.STATE) {
      throw new ForbiddenException('Only the state office can see stuck batches');
    }
    const stuckBefore = new Date(Date.now() - this.slaMinutes * 60_000);
    const batches = await this.batchDatabaseService.fetchStuckBatches(stuckBefore);
    return batches.map((batch) => ({
      ...batch,
      waitingMinutes: Math.round((Date.now() - batch.stageEnteredAt.getTime()) / 60_000),
    }));
  }
}
