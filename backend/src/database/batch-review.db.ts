import { Prisma, ReviewDecision, ReviewStage } from '@prisma/client';
import { EntityManager, prisma } from './prisma.service';

export class BatchReviewDatabaseService {
  createReview(data: Prisma.BatchReviewUncheckedCreateInput, manager: EntityManager) {
    return manager.batchReview.create({ data });
  }

  fetchReviewByReviewer(batchId: string, revision: number, stage: ReviewStage, reviewerId: number, manager: EntityManager = prisma) {
    return manager.batchReview.findUnique({
      where: { batchId_revision_stage_reviewerId: { batchId, revision, stage, reviewerId } },
    });
  }

  /** How many reviewers took this same decision on this revision at this stage. */
  countDecisions(batchId: string, revision: number, stage: ReviewStage, decision: ReviewDecision, manager: EntityManager) {
    return manager.batchReview.count({
      where: { batchId, revision, stage, decision },
    });
  }

  fetchReviewsByBatch(batchId: string, manager: EntityManager = prisma) {
    return manager.batchReview.findMany({
      where: { batchId },
      include: { reviewer: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
