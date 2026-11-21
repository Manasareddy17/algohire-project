import { UserResponse } from '../../../core/interfaces/user.interface';

/** Sent by the worker when a batch reaches APPROVED. */
export class IssueBatchCertificatesCommand {
  constructor(public readonly batchId: string) {}
}

/** One WhatsApp delivery attempt for one certificate (retried by the queue). */
export class DeliverCertificateCommand {
  constructor(public readonly certificateId: string) {}
}

/** All retries used up: mark the delivery as failed so the state office can see it. */
export class MarkDeliveryFailedCommand {
  constructor(
    public readonly certificateId: string,
    public readonly error: string,
  ) {}
}

export class RevokeCertificateCommand {
  constructor(
    public readonly certificateId: string,
    public readonly reason: string,
    public readonly user: UserResponse,
  ) {}
}
