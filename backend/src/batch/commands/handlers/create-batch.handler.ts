import { randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';
import { CommandHandler, ICommandHandler } from '../../../core/cqrs';
import { ActionType, AuditAction, Modules } from '../../../core/enums/value.enum';
import { ForbiddenException } from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import { AuditLogDatabaseService, BatchDatabaseService, DataSource } from '../../../database';
import { buildResponse } from '../../../utils/response-messages.util';
import { CreateBatchCommand } from '../impl/create-batch.command';

@CommandHandler(CreateBatchCommand)
export class CreateBatchHandler implements ICommandHandler<CreateBatchCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
  ) {}

  async execute(command: CreateBatchCommand) {
    const { batchRequest, user } = command;
    this.logger.debug(`[CreateBatch] userId: ${user.id}, course: ${batchRequest.courseCode}`);

    if (user.role !== Role.CENTRE || !user.centreId) {
      throw new ForbiddenException('Only training centres can create batches');
    }

    // Batch row + audit row are saved together, or not at all.
    const batch = await this.dataSource.transaction(async (manager) => {
      const created = await this.batchDatabaseService.createBatch(
        {
          code: `B-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`,
          centreId: user.centreId!,
          courseCode: batchRequest.courseCode,
          courseName: batchRequest.courseName,
          createdById: user.id,
        },
        manager,
      );

      await this.auditLogDatabaseService.record(
        {
          actor: user,
          action: AuditAction.BatchCreated,
          entityType: 'Batch',
          entityId: created.id,
          batchId: created.id,
          metadata: { code: created.code, courseCode: created.courseCode },
        },
        manager,
      );
      return created;
    });

    this.logger.log(`[CreateBatch] Batch created - batchId: ${batch.id}, code: ${batch.code}`);
    return buildResponse(Modules.Batch, batch.id, ActionType.Created, { code: batch.code });
  }
}
