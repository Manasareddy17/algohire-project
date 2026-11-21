import { UserResponse } from '../../../core/interfaces/user.interface';

export class SubmitBatchCommand {
  constructor(
    public readonly batchId: string,
    public readonly user: UserResponse,
  ) {}
}
