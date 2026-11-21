import { Prisma } from '@prisma/client';
import { AuditAction } from '../core/enums/value.enum';
import { UserResponse } from '../core/interfaces/user.interface';
import { getCorrelationId } from '../core/logger/request-context';
import { EntityManager, prisma } from './prisma.service';

export interface AuditEntry {
  actor: UserResponse | null;
  action: AuditAction;
  entityType: 'Batch' | 'Certificate';
  entityId: string;
  batchId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogDatabaseService {
  /** Always called inside the same transaction as the change it records. */
  record(entry: AuditEntry, manager: EntityManager) {
    return manager.auditLog.create({
      data: {
        actorId: entry.actor?.id ?? null,
        actorRole: entry.actor?.role ?? 'SYSTEM',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        batchId: entry.batchId,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        correlationId: getCorrelationId(),
      },
    });
  }

  async fetchBatchTimeline(batchId: string, manager: EntityManager = prisma) {
    const logs = await manager.auditLog.findMany({ where: { batchId }, orderBy: { id: 'asc' } });
    const actorIds = [...new Set(logs.map((log) => log.actorId).filter((id): id is number => id !== null))];
    const actors = await manager.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const nameById = new Map(actors.map((actor) => [actor.id, actor.name]));
    return logs.map((log) => ({
      id: log.id.toString(),
      action: log.action,
      actor: log.actorId ? nameById.get(log.actorId) ?? `user#${log.actorId}` : 'System',
      actorRole: log.actorRole,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      correlationId: log.correlationId,
      createdAt: log.createdAt,
    }));
  }
}
