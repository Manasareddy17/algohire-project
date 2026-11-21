import { Prisma } from '@prisma/client';
import { EntityManager, prisma } from './prisma.service';

export class CandidateDatabaseService {
  /** Replaces the whole candidate list of a batch. Callers run this inside a transaction. */
  async replaceCandidates(batchId: string, candidates: Omit<Prisma.CandidateCreateManyInput, 'batchId'>[], manager: EntityManager) {
    await manager.candidate.deleteMany({ where: { batchId } });
    await manager.candidate.createMany({ data: candidates.map((candidate) => ({ ...candidate, batchId })) });
  }

  fetchCandidatesByBatch(batchId: string, manager: EntityManager = prisma) {
    return manager.candidate.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } });
  }

  /** Enrolment ids that already hold a live certificate for this course: they must not be certified again. */
  async fetchAlreadyCertifiedEnrolmentIds(courseCode: string, enrolmentIds: string[], manager: EntityManager = prisma) {
    const rows = await manager.certificate.findMany({
      where: { enrolmentId: { in: enrolmentIds }, status: 'ISSUED', courseCode },
      select: { enrolmentId: true },
    });
    return new Set(rows.map((row) => row.enrolmentId));
  }

  /**
   * Enrolment ids of this course that already sit in ANOTHER batch which is submitted, under
   * review, sent back or approved. The same person in two such batches would end up with two
   * certificates. Drafts (not submitted yet) and rejected batches do not count.
   * Returns enrolmentId -> the other batch, so the error can say where they are.
   */
  async fetchEnrolmentsInOtherActiveBatches(
    courseCode: string,
    enrolmentIds: string[],
    excludeBatchId: string,
    manager: EntityManager = prisma,
  ) {
    const rows = await manager.candidate.findMany({
      where: {
        enrolmentId: { in: enrolmentIds },
        batchId: { not: excludeBatchId },
        batch: {
          courseCode,
          status: { in: ['DISTRICT_REVIEW', 'QUALITY_REVIEW', 'STATE_REVIEW', 'SENT_BACK', 'APPROVED'] },
        },
      },
      select: { enrolmentId: true, batch: { select: { code: true, status: true } } },
    });
    return new Map(rows.map((row) => [row.enrolmentId, row.batch]));
  }
}
