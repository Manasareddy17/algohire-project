import { CommandHandler, ICommandHandler } from '../../../core/cqrs';
import { ActionType, AuditAction, Modules } from '../../../core/enums/value.enum';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '../../../core/exceptions';
import { Logger } from '../../../core/logger/logger';
import {
  AuditLogDatabaseService,
  BatchDatabaseService,
  CandidateDatabaseService,
  DataSource,
} from '../../../database';
import { buildResponse } from '../../../utils/response-messages.util';
import { EDITABLE_STATUSES } from '../../enums';
import { BatchWorkflowService } from '../../services/batch-workflow.service';
import { CandidateSheetParserService } from '../../services/candidate-sheet-parser.service';
import { UploadCandidatesCommand } from '../impl/upload-candidates.command';

/**
 * Moment 1 of the brief: "A centre uploads a spreadsheet with a few bad rows. They find out
 * exactly what is wrong, and nothing half-saved ends up in the system."
 *
 *  - every row is validated first and ALL errors are returned (row + column + message);
 *  - if there is even one error we throw before opening a transaction: nothing is written;
 *  - if all rows are fine, old candidates are replaced by new ones in ONE transaction,
 *    so a crash half-way rolls back and the batch keeps its previous list.
 */
@CommandHandler(UploadCandidatesCommand)
export class UploadCandidatesHandler implements ICommandHandler<UploadCandidatesCommand> {
  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly candidateDatabaseService: CandidateDatabaseService,
    private readonly auditLogDatabaseService: AuditLogDatabaseService,
    private readonly batchWorkflowService: BatchWorkflowService,
    private readonly candidateSheetParserService: CandidateSheetParserService,
  ) {}

  async execute(command: UploadCandidatesCommand) {
    const { batchId, file, user } = command;
    this.logger.debug(`[UploadCandidates] batchId: ${batchId}, file: ${file.originalName}`);

    const batch = await this.batchDatabaseService.fetchBatchById(batchId);
    if (!batch) throw new NotFoundException('Batch not found');
    this.batchWorkflowService.assertCentreOwnsBatch(user, batch);
    this.assertEditable(batch.status);

    // 1. Read and validate the whole file.
    const rows = await this.candidateSheetParserService.readRows(file.buffer, file.originalName);
    if (rows.length === 0) {
      throw new BadRequestException('Upload a .csv or .xlsx file with a header row');
    }
    const { candidates, errors } = this.candidateSheetParserService.validateRows(rows);

    // A candidate who already holds a valid certificate for this course must not get a second one.
    const alreadyCertified = await this.candidateDatabaseService.fetchAlreadyCertifiedEnrolmentIds(
      batch.courseCode,
      candidates.map((candidate) => candidate.enrolmentId),
    );
    // ...and must not sit in another batch of the same course that is already submitted or approved,
    // otherwise approving both batches would give them two certificates.
    const inOtherBatches = await this.candidateDatabaseService.fetchEnrolmentsInOtherActiveBatches(
      batch.courseCode,
      candidates.map((candidate) => candidate.enrolmentId),
      batchId,
    );
    for (const candidate of candidates) {
      const otherBatch = inOtherBatches.get(candidate.enrolmentId);
      if (alreadyCertified.has(candidate.enrolmentId)) {
        errors.push({
          row: candidate.rowNumber,
          column: 'enrolment_id',
          message: 'This candidate already has a certificate for this course',
        });
      } else if (otherBatch) {
        errors.push({
          row: candidate.rowNumber,
          column: 'enrolment_id',
          message: `Already in batch ${otherBatch.code} (${otherBatch.status}) for this course`,
        });
      }
    }

    // 2. Any error -> reject the whole file. Nothing has been written yet.
    if (errors.length > 0) {
      this.logger.warn(`[UploadCandidates] Rejected file with ${errors.length} error(s) - batchId: ${batchId}`);
      throw new UnprocessableEntityException('The file has errors. Nothing was saved.', {
        errors: errors.sort((a, b) => a.row - b.row),
      });
    }

    // 3. All rows valid -> replace the candidate list in one transaction.
    await this.dataSource.transaction(async (manager) => {
      // Lock + re-check: the batch may have been submitted while we were parsing the file.
      const locked = await this.batchDatabaseService.lockBatchForUpdate(batchId, manager);
      this.assertEditable(locked!.status);

      await this.candidateDatabaseService.replaceCandidates(batchId, candidates, manager);
      await this.auditLogDatabaseService.record(
        {
          actor: user,
          action: AuditAction.CandidatesUploaded,
          entityType: 'Batch',
          entityId: batchId,
          batchId,
          metadata: { fileName: file.originalName, candidateCount: candidates.length },
        },
        manager,
      );
    });

    this.logger.log(`[UploadCandidates] Saved ${candidates.length} candidates - batchId: ${batchId}`);
    return buildResponse(Modules.Batch, batchId, ActionType.Uploaded, { candidateCount: candidates.length });
  }

  private assertEditable(status: string) {
    if (!(EDITABLE_STATUSES as readonly string[]).includes(status)) {
      throw new ConflictException(`Candidates can only be changed while the batch is a draft or sent back (now: ${status})`);
    }
  }
}
