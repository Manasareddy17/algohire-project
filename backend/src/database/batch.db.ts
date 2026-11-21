import { BatchStatus, Prisma } from '@prisma/client';
import { EntityManager, prisma } from './prisma.service';

const batchWithCentre = {
  centre: { select: { id: true, code: true, name: true, districtId: true, district: { select: { name: true } } } },
  _count: { select: { candidates: true, certificates: true } },
} satisfies Prisma.BatchInclude;

export type BatchWithCentre = Prisma.BatchGetPayload<{ include: typeof batchWithCentre }>;

export class BatchDatabaseService {
  createBatch(data: Prisma.BatchUncheckedCreateInput, manager: EntityManager = prisma) {
    return manager.batch.create({ data, include: batchWithCentre });
  }

  fetchBatchById(id: string, manager: EntityManager = prisma): Promise<BatchWithCentre | null> {
    return manager.batch.findUnique({ where: { id }, include: batchWithCentre });
  }

  /**
   * Locks the batch row until the transaction ends. Every state change on a batch goes
   * through this lock, so two officers acting at the same instant are serialised.
   */
  async lockBatchForUpdate(id: string, manager: Prisma.TransactionClient): Promise<BatchWithCentre | null> {
    const rows = await manager.$queryRaw<{ id: string }[]>`SELECT id FROM batches WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return this.fetchBatchById(id, manager);
  }

  updateBatch(id: string, data: Prisma.BatchUpdateInput, manager: EntityManager = prisma) {
    return manager.batch.update({ where: { id }, data });
  }

  fetchBatches(where: Prisma.BatchWhereInput, manager: EntityManager = prisma) {
    return manager.batch.findMany({ where, include: batchWithCentre, orderBy: { updatedAt: 'desc' }, take: 200 });
  }

  fetchStuckBatches(stuckBefore: Date, manager: EntityManager = prisma) {
    return manager.batch.findMany({
      where: {
        status: { in: [BatchStatus.DISTRICT_REVIEW, BatchStatus.QUALITY_REVIEW, BatchStatus.STATE_REVIEW] },
        stageEnteredAt: { lt: stuckBefore },
      },
      include: batchWithCentre,
      orderBy: { stageEnteredAt: 'asc' },
    });
  }

  /** Conditional update: only marks batches not already escalated, so concurrent scanners escalate once. */
  markEscalated(id: string, stageEnteredAt: Date, manager: EntityManager = prisma) {
    return manager.batch.updateMany({
      where: { id, stageEnteredAt, escalatedAt: null },
      data: { escalatedAt: new Date() },
    });
  }
}
