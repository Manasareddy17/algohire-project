import { Role } from '@prisma/client';
import { CacheService } from '../../../core/cache/cache.service';
import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { ActionType, AuditAction, Modules } from '../../../core/enums/value.enum';
import { ConflictException, ForbiddenException, NotFoundException } from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, CertificateDatabaseService, DataSource } from '../../../database';
import { buildResponse } from '../../../utils/response-messages.util';
import { CertificateRevokedEvent } from '../../events/impl/certificate.events';
import { verifyCacheKey } from '../../queries/handlers/verify-certificate.handler';
import { RevokeCertificateCommand } from '../impl';

/**
 * Moment 4: "The state office cancels a fake certificate. An employer checking it
 * a minute later is told it is no longer valid."
 *
 *  - the status change, audit row and event are one transaction;
 *  - right after the commit we delete the cached verification answer, so the next check
 *    reads REVOKED from Postgres;
 *  - if Redis is down and the delete fails, the cached answer still expires within 30 seconds.
 */
@CommandHandler(RevokeCertificateCommand)
export class RevokeCertificateHandler implements ICommandHandler<RevokeCertificateCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RevokeCertificateCommand) {
    const { certificateId, reason, user } = command;
    if (user.role !== Role.STATE) {
      throw new ForbiddenException('Only the state office can cancel a certificate');
    }

    const certificate = await this.dataSource.transaction(async (manager) => {
      const found = await this.certificateDatabaseService.fetchCertificateWithScope(certificateId, manager);
      if (!found) throw new NotFoundException('Certificate not found');

      // Only ISSUED -> REVOKED. Two clicks at once: the second one updates 0 rows.
      const { count } = await this.certificateDatabaseService.revoke(certificateId, user.id, reason, manager);
      if (count === 0) throw new ConflictException('Certificate is already cancelled');

      await this.auditLogDatabaseService.record(
        {
          actor: user,
          action: AuditAction.CertificateRevoked,
          entityType: 'Certificate',
          entityId: certificateId,
          batchId: found.batchId,
          metadata: { certificateNo: found.certificateNo, reason },
        },
        manager,
      );
      await this.eventBus.publish(manager, CertificateRevokedEvent, certificateId, {
        certificateId,
        certificateNo: found.certificateNo,
        batchId: found.batchId,
        centreId: found.batch.centreId,
        districtId: found.batch.centre.districtId,
      });
      return found;
    });

    await this.cacheService.del(verifyCacheKey(certificate.certificateNo));

    this.logger.log(`[RevokeCertificate] Revoked ${certificate.certificateNo} by userId: ${user.id}`);
    return buildResponse(Modules.Certificate, certificateId, ActionType.Revoked, {
      certificateNo: certificate.certificateNo,
    });
  }
}
