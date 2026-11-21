import { CertificateStatus, DeliveryStatus, Prisma } from '@prisma/client';
import { EntityManager, prisma } from './prisma.service';

export class CertificateDatabaseService {
  fetchCertificateById(id: string, manager: EntityManager = prisma) {
    return manager.certificate.findUnique({ where: { id } });
  }

  /** Certificate + the centre/district it belongs to (for permission checks and realtime routing). */
  fetchCertificateWithScope(id: string, manager: EntityManager = prisma) {
    return manager.certificate.findUnique({
      where: { id },
      include: { batch: { select: { centreId: true, centre: { select: { districtId: true } } } } },
    });
  }

  fetchCertificateByNo(certificateNo: string, manager: EntityManager = prisma) {
    return manager.certificate.findUnique({ where: { certificateNo } });
  }

  fetchCertificatesByBatch(batchId: string, manager: EntityManager = prisma) {
    return manager.certificate.findMany({ where: { batchId }, orderBy: { candidateName: 'asc' } });
  }

  searchCertificates(where: Prisma.CertificateWhereInput, manager: EntityManager = prisma) {
    return manager.certificate.findMany({ where, orderBy: { issuedAt: 'desc' }, take: 100 });
  }

  /** Enrolment ids holding a VALID certificate for this course from a batch other than `excludeBatchId`. */
  async fetchValidEnrolmentsElsewhere(courseCode: string, enrolmentIds: string[], excludeBatchId: string, manager: EntityManager = prisma) {
    const rows = await manager.certificate.findMany({
      where: {
        courseCode,
        enrolmentId: { in: enrolmentIds },
        status: CertificateStatus.ISSUED,
        batchId: { not: excludeBatchId },
      },
      select: { enrolmentId: true },
    });
    return new Set(rows.map((row) => row.enrolmentId));
  }

  /**
   * Inserts the certificate unless it would break a unique rule: the candidate already has one
   * (candidate_id) or the person already holds a valid one for the course (partial unique index).
   */
  async createIfAbsent(data: Prisma.CertificateUncheckedCreateInput, manager: EntityManager) {
    const result = await manager.certificate.createMany({ data: [data], skipDuplicates: true });
    return result.count === 1;
  }

  /** Conditional update: returns 0 when the certificate was not ISSUED (already revoked or missing). */
  revoke(id: string, revokedById: number, reason: string, manager: EntityManager) {
    return manager.certificate.updateMany({
      where: { id, status: CertificateStatus.ISSUED },
      data: { status: CertificateStatus.REVOKED, revokedAt: new Date(), revokedById, revokeReason: reason },
    });
  }

  updateCertificate(id: string, data: Prisma.CertificateUpdateInput, manager: EntityManager = prisma) {
    return manager.certificate.update({ where: { id }, data });
  }

  markDelivered(id: string, providerMessageId: string, manager: EntityManager = prisma) {
    return manager.certificate.updateMany({
      where: { id, deliveryStatus: { not: DeliveryStatus.SENT } },
      data: {
        deliveryStatus: DeliveryStatus.SENT,
        deliveredAt: new Date(),
        providerMessageId,
        lastDeliveryError: null,
      },
    });
  }
}
