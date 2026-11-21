import { BatchStatus } from '@prisma/client';
import { CommandHandler, EventBus, ICommandHandler } from '../../../core/cqrs';
import { AuditAction } from '../../../core/enums/value.enum';
import { NotFoundException } from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import {
  AuditLogDatabaseService,
  BatchDatabaseService,
  CandidateDatabaseService,
  CertificateDatabaseService,
  DataSource,
} from '../../../database';
import { CertificateIssuedEvent } from '../../events/impl/certificate.events';
import { generateCertificateNo } from '../../services/certificate-number.service';
import { IssueBatchCertificatesCommand } from '../impl';

/**
 * Moment 3 (part 1): "Every candidate ends up with exactly one certificate".
 *
 * Safe to run any number of times for the same batch (the queue may deliver the
 * `batch.approved` event twice, or a worker may crash half-way):
 *  - certificates.candidate_id is UNIQUE, and we insert with skipDuplicates,
 *    so a candidate who already has a certificate is skipped, never doubled;
 *  - it all runs in one transaction: a crash half-way rolls back, and the retry starts clean;
 *  - only certificates created in THIS run get a `certificate.issued` event, so a re-run
 *    does not trigger a second WhatsApp message.
 */
@CommandHandler(IssueBatchCertificatesCommand)
export class IssueBatchCertificatesHandler implements ICommandHandler<IssueBatchCertificatesCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly candidateDatabaseService: CandidateDatabaseService,
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: IssueBatchCertificatesCommand) {
    const { batchId } = command;
    const batch = await this.batchDatabaseService.fetchBatchById(batchId);
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status !== BatchStatus.APPROVED) {
      this.logger.warn(`[IssueBatchCertificates] Batch ${batchId} is ${batch.status}, not APPROVED - skipping`);
      return { issued: 0 };
    }

    const candidates = await this.candidateDatabaseService.fetchCandidatesByBatch(batchId);

    const issued = await this.dataSource.transaction(async (manager) => {
      // Safety net: anyone who already holds a VALID certificate for this course from another
      // batch is skipped (upload/submit checks should already have stopped this).
      const certifiedElsewhere = await this.certificateDatabaseService.fetchValidEnrolmentsElsewhere(
        batch.courseCode,
        candidates.map((candidate) => candidate.enrolmentId),
        batchId,
        manager,
      );

      const newlyIssuedCandidateIds = new Set<string>();
      for (const candidate of candidates) {
        if (certifiedElsewhere.has(candidate.enrolmentId)) {
          await this.auditLogDatabaseService.record(
            {
              actor: null,
              action: AuditAction.CertificateSkippedDuplicate,
              entityType: 'Batch',
              entityId: batchId,
              batchId,
              metadata: { enrolmentId: candidate.enrolmentId, reason: 'Already holds a valid certificate for this course' },
            },
            manager,
          );
          continue;
        }
        const created = await this.certificateDatabaseService.createIfAbsent(
          {
            certificateNo: generateCertificateNo(),
            candidateId: candidate.id,
            batchId,
            candidateName: candidate.name,
            phone: candidate.phone,
            enrolmentId: candidate.enrolmentId,
            courseCode: batch.courseCode,
            courseName: batch.courseName,
            centreName: batch.centre.name,
          },
          manager,
        );
        if (created) newlyIssuedCandidateIds.add(candidate.id);
      }

      // Every other candidate must now have exactly one certificate. If not (a random number clash,
      // or another batch certified the same person a moment ago), throw: the whole transaction
      // rolls back and the queue retries; the retry then sees the other certificate and skips.
      const certificates = await this.certificateDatabaseService.fetchCertificatesByBatch(batchId, manager);
      const expected = candidates.length - certifiedElsewhere.size;
      if (certificates.length !== expected) {
        throw new Error(`Expected ${expected} certificates, found ${certificates.length}; retrying`);
      }

      const newCertificates = certificates.filter((certificate) => newlyIssuedCandidateIds.has(certificate.candidateId));
      for (const certificate of newCertificates) {
        await this.auditLogDatabaseService.record(
          {
            actor: null,
            action: AuditAction.CertificateIssued,
            entityType: 'Certificate',
            entityId: certificate.id,
            batchId,
            metadata: { certificateNo: certificate.certificateNo },
          },
          manager,
        );
        await this.eventBus.publish(manager, CertificateIssuedEvent, certificate.id, {
          certificateId: certificate.id,
          certificateNo: certificate.certificateNo,
          batchId,
          centreId: batch.centreId,
          districtId: batch.centre.districtId,
        });
      }
      return newCertificates.length;
    });

    this.logger.log(`[IssueBatchCertificates] Issued ${issued} certificate(s) - batchId: ${batchId}`);
    return { issued };
  }
}
