import { Prisma } from '@prisma/client';
import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { CertificateDatabaseService } from '../../../database';
import { maskPhone } from '../../../utils/mask.util';
import { batchScopeFor } from '../../../batch/queries/handlers/fetch-batches.handler';
import { FetchCertificatesQuery } from '../impl';

@QueryHandler(FetchCertificatesQuery)
export class FetchCertificatesHandler implements IQueryHandler<FetchCertificatesQuery> {
  constructor(private readonly certificateDatabaseService: CertificateDatabaseService) {}

  async execute(query: FetchCertificatesQuery) {
    const { filter, user } = query;
    const search = filter.search?.trim();

    const where: Prisma.CertificateWhereInput = {
      batch: batchScopeFor(user), // each role only sees certificates of batches it may see
      ...(filter.batchId ? { batchId: filter.batchId } : {}),
      ...(search
        ? {
            OR: [
              { certificateNo: { contains: search.toUpperCase() } },
              { candidateName: { contains: search, mode: 'insensitive' } },
              { enrolmentId: { contains: search.toUpperCase() } },
            ],
          }
        : {}),
    };

    const certificates = await this.certificateDatabaseService.searchCertificates(where);
    return certificates.map(({ pdfPath, providerMessageId, ...certificate }) => ({
      ...certificate,
      phone: maskPhone(certificate.phone),
    }));
  }
}
