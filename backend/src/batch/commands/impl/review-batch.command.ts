import { UserResponse } from '../../../core/interfaces/user.interface';
import { ReviewBatchDto } from '../../dto/batch-request.dto';

/** One command for approve / send back / reject, like Approve/RejectWorkRequest share their flow. */
export class ReviewBatchCommand {
  constructor(
    public readonly batchId: string,
    public readonly reviewRequest: ReviewBatchDto,
    public readonly user: UserResponse,
  ) {}
}
