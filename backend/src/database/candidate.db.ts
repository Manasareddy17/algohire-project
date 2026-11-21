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
      where: { enrolmentId: { in: enrolmentIds }, status: 'ISSUED', batch: { courseCode } },
      select: { enrolmentId: true },
    });
    return new Set(rows.map((row) => row.enrolmentId));
  }
}
