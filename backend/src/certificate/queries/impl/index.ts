import { UserResponse } from '../../../core/interfaces/user.interface';

/** Public, no login: is this certificate genuine? */
export class VerifyCertificateQuery {
  constructor(public readonly certificateNo: string) {}
}

/** Public, but needs the signed token from the WhatsApp link. */
export class FetchCertificateFileQuery {
  constructor(
    public readonly certificateNo: string,
    public readonly token: string,
  ) {}
}

/** Staff search (state office uses it to find a certificate to cancel). */
export class FetchCertificatesQuery {
  constructor(
    public readonly filter: { batchId?: string; search?: string },
    public readonly user: UserResponse,
  ) {}
}
