import { UserResponse } from '../../../core/interfaces/user.interface';

export class UploadCandidatesCommand {
  constructor(
    public readonly batchId: string,
    public readonly file: { buffer: Buffer; originalName: string },
    public readonly user: UserResponse,
  ) {}
}
