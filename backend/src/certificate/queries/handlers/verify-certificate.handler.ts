import { CertificateStatus } from '@prisma/client';
import { CacheService } from '../../../core/cache/cache.service';
import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { CertificateDatabaseService } from '../../../database';
import { maskName } from '../../../utils/mask.util';
import { CERTIFICATE_NO_PATTERN } from '../../services/certificate-number.service';
import { VerifyCertificateQuery } from '../impl';

export const VERIFY_CACHE_TTL_SECONDS = 30;
export const verifyCacheKey = (certificateNo: string) => `verify:${certificateNo}`;

export interface VerificationResult {
  certificateNo: string;
  result: 'VALID' | 'REVOKED' | 'NOT_FOUND';
  candidateName?: string;
  courseName?: string;
  centreName?: string;
  issuedAt?: Date;
  revokedAt?: Date | null;
}

/**
 * Public verification. Shows only what an employer needs to compare with the paper:
 * a masked name, the course, the centre and the date. Never the phone number.
 *
 * Bursts of lookups are served from Redis (30 s). Revoking deletes the cache entry,
 * so a cancelled certificate never shows as valid.
 */
@QueryHandler(VerifyCertificateQuery)
export class VerifyCertificateHandler implements IQueryHandler<VerifyCertificateQuery> {
  constructor(
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly cacheService: CacheService,
  ) {}

  async execute(query: VerifyCertificateQuery): Promise<VerificationResult> {
    const certificateNo = query.certificateNo.trim().toUpperCase();
    if (!CERTIFICATE_NO_PATTERN.test(certificateNo)) {
      return { certificateNo, result: 'NOT_FOUND' }; // bad format: do not even hit the database
    }

    const cached = await this.cacheService.get<VerificationResult>(verifyCacheKey(certificateNo));
    if (cached) return cached;

    const certificate = await this.certificateDatabaseService.fetchCertificateByNo(certificateNo);
    const result: VerificationResult = certificate
      ? {
          certificateNo,
          result: certificate.status === CertificateStatus.ISSUED ? 'VALID' : 'REVOKED',
          candidateName: maskName(certificate.candidateName),
          courseName: certificate.courseName,
          centreName: certificate.centreName,
          issuedAt: certificate.issuedAt,
          revokedAt: certificate.revokedAt,
        }
      : { certificateNo, result: 'NOT_FOUND' };

    await this.cacheService.set(verifyCacheKey(certificateNo), result, VERIFY_CACHE_TTL_SECONDS);
    return result;
  }
}
