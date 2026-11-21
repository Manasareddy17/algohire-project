import { UserResponse } from '../../../core/interfaces/user.interface';
import { CreateBatchDto } from '../../dto/batch-request.dto';

export class CreateBatchCommand {
  constructor(
    public readonly batchRequest: CreateBatchDto,
    public readonly user: UserResponse,
  ) {}
}
