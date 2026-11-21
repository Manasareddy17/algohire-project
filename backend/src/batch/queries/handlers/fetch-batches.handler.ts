import { Prisma, Role } from '@prisma/client';
import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { UserResponse } from '../../../core/interfaces/user.interface';
import { BatchDatabaseService } from '../../../database';
import { FetchBatchesQuery } from '../impl';

/** Limits any batch query to what this user may see. Used by several handlers. */
export function batchScopeFor(user: UserResponse): Prisma.BatchWhereInput {
  switch (user.role) {
    case Role.CENTRE:
      return { centreId: user.centreId ?? -1 };
    case Role.DISTRICT_OFFICER:
      return { centre: { districtId: user.districtId ?? -1 } };
    default:
      return {};
  }
}

@QueryHandler(FetchBatchesQuery)
export class FetchBatchesHandler implements IQueryHandler<FetchBatchesQuery> {
  constructor(private readonly batchDatabaseService: BatchDatabaseService) {}

  async execute(query: FetchBatchesQuery) {
    const { filter, user } = query;
    return this.batchDatabaseService.fetchBatches({
      ...batchScopeFor(user),
      ...(filter.status ? { status: filter.status } : {}),
    });
  }
}
