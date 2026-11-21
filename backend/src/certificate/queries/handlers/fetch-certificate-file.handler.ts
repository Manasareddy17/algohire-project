import { CertificateStatus } from '@prisma/client';
import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { ForbiddenException, GoneException, NotFoundException } from '../../../core/exceptions';
import { CertificateDatabaseService } from '../../../database';
import { CertificatePdfService } from '../../services/certificate-pdf.service';
import { DownloadTokenService } from '../../services/download-token.service';
import { FetchCertificateFileQuery } from '../impl';

/** "A stranger getting hold of someone else's certificate" must never happen: the signed token is required. */
@QueryHandler(FetchCertificateFileQuery)
export class FetchCertificateFileHandler implements IQueryHandler<FetchCertificateFileQuery> {
  constructor(
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly certificatePdfService: CertificatePdfService,
    private readonly downloadTokenService: DownloadTokenService,
  ) {}

  async execute(query: FetchCertificateFileQuery) {
    const certificateNo = query.certificateNo.toUpperCase();
    if (!this.downloadTokenService.isValid(certificateNo, query.token ?? '')) {
      throw new ForbiddenException('This download link is invalid or has expired');
    }

    const certificate = await this.certificateDatabaseService.fetchCertificateByNo(certificateNo);
    if (!certificate) throw new NotFoundException('Certificate not found');
    if (certificate.status === CertificateStatus.REVOKED) {
      throw new GoneException('This certificate has been cancelled');
    }

    const filePath = await this.certificatePdfService.ensurePdf(certificate);
    return { filePath, fileName: `${certificate.certificateNo}.pdf` };
  }
}
