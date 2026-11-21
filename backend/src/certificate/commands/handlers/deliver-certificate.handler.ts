import { CertificateStatus, DeliveryStatus } from '@prisma/client';
import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { AuditAction } from '../../../core/enums/value.enum';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, CertificateDatabaseService, DataSource } from '../../../database';
import { WhatsAppClient } from '../../../notification/whatsapp/whatsapp.client';
import { CertificateDeliveredEvent } from '../../events/impl/certificate.events';
import { CertificatePdfService } from '../../services/certificate-pdf.service';
import { DownloadTokenService } from '../../services/download-token.service';
import { DeliverCertificateCommand } from '../impl';

/**
 * Moment 3 (part 2): "Every candidate ends up with exactly one certificate on their phone,
 * even though WhatsApp is unreliable."
 *
 *  - runs in the worker, never in the user's HTTP request: a slow WhatsApp never blocks anyone;
 *  - if WhatsApp fails or times out we throw, and the queue retries with growing delays;
 *  - every retry sends the SAME idempotency key (the certificate id). If WhatsApp actually
 *    delivered but the answer was lost, the retry is recognised and not sent again;
 *  - already SENT or REVOKED -> do nothing.
 */
@CommandHandler(DeliverCertificateCommand)
export class DeliverCertificateHandler implements ICommandHandler<DeliverCertificateCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly certificatePdfService: CertificatePdfService,
    private readonly downloadTokenService: DownloadTokenService,
    private readonly whatsAppClient: WhatsAppClient,
    private readonly eventBus: EventBus,
    private readonly publicBaseUrl: string,
  ) {}

  async execute(command: DeliverCertificateCommand) {
    const { certificateId } = command;
    const certificate = await this.certificateDatabaseService.fetchCertificateWithScope(certificateId);
    if (!certificate) return { skipped: 'not found' };
    if (certificate.status === CertificateStatus.REVOKED) return { skipped: 'revoked' };
    if (certificate.deliveryStatus === DeliveryStatus.SENT) return { skipped: 'already sent' };

    // 1. PDF (created once, reused on retries).
    const pdfPath = await this.certificatePdfService.ensurePdf(certificate);
    const token = this.downloadTokenService.create(certificate.certificateNo);
    const downloadUrl = `${this.publicBaseUrl}/api/public/certificates/${certificate.certificateNo}/pdf?token=${token}`;

    // 2. Send. On failure: remember the error, then rethrow so the queue retries.
    let messageId: string;
    try {
      const result = await this.whatsAppClient.sendDocument({
        to: certificate.phone,
        documentUrl: downloadUrl,
        fileName: `${certificate.certificateNo}.pdf`,
        caption: `Congratulations ${certificate.candidateName}! Your certificate for ${certificate.courseName} (No. ${certificate.certificateNo}) is attached.`,
        idempotencyKey: certificate.id,
      });
      messageId = result.messageId;
    } catch (err) {
      await this.certificateDatabaseService.updateCertificate(certificateId, {
        pdfPath,
        deliveryAttempts: { increment: 1 },
        lastDeliveryError: (err as Error).message.slice(0, 500),
      });
      this.logger.warn(`[DeliverCertificate] Attempt failed - certificateId: ${certificateId}: ${(err as Error).message}`);
      throw err;
    }

    // 3. Mark as sent + audit + event, together.
    await this.dataSource.transaction(async (manager) => {
      const { count } = await this.certificateDatabaseService.markDelivered(certificateId, messageId, manager);
      if (count === 0) return; // a parallel attempt already recorded it
      await this.certificateDatabaseService.updateCertificate(
        certificateId,
        { pdfPath, deliveryAttempts: { increment: 1 } },
        manager,
      );
      await this.auditLogDatabaseService.record(
        {
          actor: null,
          action: AuditAction.CertificateDelivered,
          entityType: 'Certificate',
          entityId: certificateId,
          batchId: certificate.batchId,
          metadata: { certificateNo: certificate.certificateNo, providerMessageId: messageId },
        },
        manager,
      );
      await this.eventBus.publish(manager, CertificateDeliveredEvent, certificateId, {
        certificateId,
        certificateNo: certificate.certificateNo,
        batchId: certificate.batchId,
        centreId: certificate.batch.centreId,
        districtId: certificate.batch.centre.districtId,
      });
    });

    this.logger.log(`[DeliverCertificate] Delivered - certificateId: ${certificateId}, messageId: ${messageId}`);
    return { delivered: true, messageId };
  }
}
