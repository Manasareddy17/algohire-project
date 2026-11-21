import { CommandBus, QueryBus, EventBus } from '../core/cqrs';
import {
  AuditLogDatabaseService,
  BatchDatabaseService,
  BatchReviewDatabaseService,
  CandidateDatabaseService,
  CertificateDatabaseService,
  DataSource,
} from '../database';
import {
  CreateBatchHandler,
  EscalateStuckBatchesHandler,
  ReviewBatchHandler,
  SubmitBatchHandler,
  UploadCandidatesHandler,
} from './commands/handlers';
import {
  FetchBatchTimelineHandler,
  FetchBatchesHandler,
  FetchOneBatchHandler,
  FetchPendingReviewsHandler,
  FetchStuckBatchesHandler,
} from './queries/handlers';
import { BatchWorkflowService } from './services/batch-workflow.service';
import { CandidateSheetParserService } from './services/candidate-sheet-parser.service';

export interface BatchModuleDeps {
  commandBus: CommandBus;
  queryBus: QueryBus;
  eventBus: EventBus;
  dataSource: DataSource;
  slaMinutes: number;
  districtApprovalsRequired: number;
  qualityReviewThreshold: number;
}

/** Same job as a NestJS @Module: create the handlers with their dependencies and register them. */
export function registerBatchModule(deps: BatchModuleDeps) {
  const { commandBus, queryBus, eventBus, dataSource, slaMinutes } = deps;

  const batchDatabaseService = new BatchDatabaseService();
  const candidateDatabaseService = new CandidateDatabaseService();
  const batchReviewDatabaseService = new BatchReviewDatabaseService();
  const certificateDatabaseService = new CertificateDatabaseService();
  const auditLogDatabaseService = new AuditLogDatabaseService();
  const batchWorkflowService = new BatchWorkflowService({
    districtApprovalsRequired: deps.districtApprovalsRequired,
    qualityReviewThreshold: deps.qualityReviewThreshold,
  });
  const candidateSheetParserService = new CandidateSheetParserService();

  commandBus.register(
    new CreateBatchHandler(dataSource, batchDatabaseService, auditLogDatabaseService),
    new UploadCandidatesHandler(
      dataSource,
      batchDatabaseService,
      candidateDatabaseService,
      auditLogDatabaseService,
      batchWorkflowService,
      candidateSheetParserService,
    ),
    new SubmitBatchHandler(dataSource, batchDatabaseService, auditLogDatabaseService, batchWorkflowService, eventBus),
    new ReviewBatchHandler(
      dataSource,
      batchDatabaseService,
      batchReviewDatabaseService,
      auditLogDatabaseService,
      batchWorkflowService,
      eventBus,
    ),
    new EscalateStuckBatchesHandler(dataSource, batchDatabaseService, auditLogDatabaseService, eventBus, slaMinutes),
  );

  queryBus.register(
    new FetchBatchesHandler(batchDatabaseService),
    new FetchOneBatchHandler(
      batchDatabaseService,
      candidateDatabaseService,
      batchReviewDatabaseService,
      certificateDatabaseService,
      batchWorkflowService,
    ),
    new FetchPendingReviewsHandler(batchDatabaseService, batchReviewDatabaseService, batchWorkflowService),
    new FetchBatchTimelineHandler(batchDatabaseService, auditLogDatabaseService, batchWorkflowService),
    new FetchStuckBatchesHandler(batchDatabaseService, slaMinutes),
  );
}
