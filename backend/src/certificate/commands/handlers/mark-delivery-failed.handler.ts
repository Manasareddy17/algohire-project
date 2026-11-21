import { DeliveryStatus } from '@prisma/client';
import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { AuditAction } from '../../../core/enums/value.enum';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, CertificateDatabaseService, DataSource } from '../../../database';
import { CertificateDeliveryFailedEvent } from '../../events/impl/certificate.events';
import { MarkDeliveryFailedCommand } from '../impl';

@CommandHandler(MarkDeliveryFailedCommand)
export class MarkDeliveryFailedHandler implements ICommandHandler<MarkDeliveryFailedCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: MarkDeliveryFailedCommand) {
    const { certificateId, error } = command;

    await this.dataSource.transaction(async (manager) => {
      const certificate = await this.certificateDatabaseService.fetchCertificateWithScope(certificateId, manager);
      if (!certificate || certificate.deliveryStatus === DeliveryStatus.SENT) return;

      await this.certificateDatabaseService.updateCertificate(
        certificateId,
        { deliveryStatus: DeliveryStatus.FAILED, lastDeliveryError: error.slice(0, 500) },
        manager,
      );
      await this.auditLogDatabaseService.record(
        {
          actor: null,
          action: AuditAction.CertificateDeliveryFailed,
          entityType: 'Certificate',
          entityId: certificateId,
          batchId: certificate.batchId,
          metadata: { certificateNo: certificate.certificateNo, error },
        },
        manager,
      );
      await this.eventBus.publish(manager, CertificateDeliveryFailedEvent, certificateId, {
        certificateId,
        certificateNo: certificate.certificateNo,
        batchId: certificate.batchId,
        centreId: certificate.batch.centreId,
        districtId: certificate.batch.centre.districtId,
      });
    });

    this.logger.error(`[MarkDeliveryFailed] Gave up delivering certificateId: ${certificateId}: ${error}`);
  }
}
