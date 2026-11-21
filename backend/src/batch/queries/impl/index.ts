import { UserResponse } from '../../../core/interfaces/user.interface';
import { FetchBatchesDto } from '../../dto/batch-request.dto';

export class FetchBatchesQuery {
  constructor(
    public readonly filter: FetchBatchesDto,
    public readonly user: UserResponse,
  ) {}
}

export class FetchOneBatchQuery {
  constructor(
    public readonly batchId: string,
    public readonly user: UserResponse,
  ) {}
}

/** "What is waiting for me": batches at my stage that I have not reviewed yet. */
export class FetchPendingReviewsQuery {
  constructor(public readonly user: UserResponse) {}
}

export class FetchBatchTimelineQuery {
  constructor(
    public readonly batchId: string,
    public readonly user: UserResponse,
  ) {}
}

/** State office: batches waiting longer than the SLA. */
export class FetchStuckBatchesQuery {
  constructor(public readonly user: UserResponse) {}
}
