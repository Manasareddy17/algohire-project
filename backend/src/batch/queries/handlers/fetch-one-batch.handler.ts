import { IQueryHandler, QueryHandler } from '../../../core/cqrs';
import { NotFoundException } from '../../../core/exceptions';
import {
  BatchDatabaseService,
  BatchReviewDatabaseService,
  CandidateDatabaseService,
  CertificateDatabaseService,
} from '../../../database';
import { BatchWorkflowService } from '../../services/batch-workflow.service';
import { FetchOneBatchQuery } from '../impl';

@QueryHandler(FetchOneBatchQuery)
export class FetchOneBatchHandler implements IQueryHandler<FetchOneBatchQuery> {
  constructor(
    private readonly batchDatabaseService: BatchDatabaseService,
    private readonly candidateDatabaseService: CandidateDatabaseService,
    private readonly batchReviewDatabaseService: BatchReviewDatabaseService,
    private readonly certificateDatabaseService: CertificateDatabaseService,
    private readonly batchWorkflowService: BatchWorkflowService,
  ) {}

  async execute(query: FetchOneBatchQuery) {
    const { batchId, user } = query;
    const batch = await this.batchDatabaseService.fetchBatchById(batchId);

    // Same 404 for "does not exist" and "not yours": do not reveal other centres' batches.
    if (!batch || !this.batchWorkflowService.canView(user, batch)) {
      throw new NotFoundException('Batch not found');
    }

    const [candidates, reviews, certificates] = await Promise.all([
      this.candidateDatabaseService.fetchCandidatesByBatch(batchId),
      this.batchReviewDatabaseService.fetchReviewsByBatch(batchId),
      this.certificateDatabaseService.fetchCertificatesByBatch(batchId),
    ]);

    const stage = this.batchWorkflowService.stageForStatus(batch.status);
    return {
      ...batch,
      stage,
      decisionsRequired: stage ? this.batchWorkflowService.decisionsRequired(stage) : null,
      candidates,
      reviews: reviews.map((review) => ({
        id: review.id,
        revision: review.revision,
        stage: review.stage,
        decision: review.decision,
        reason: review.reason,
        reviewer: review.reviewer.name,
        reviewerId: review.reviewerId,
        createdAt: review.createdAt,
      })),
      certificates: certificates.map((certificate) => ({
        id: certificate.id,
        certificateNo: certificate.certificateNo,
        candidateId: certificate.candidateId,
        candidateName: certificate.candidateName,
        status: certificate.status,
        deliveryStatus: certificate.deliveryStatus,
        deliveryAttempts: certificate.deliveryAttempts,
        lastDeliveryError: certificate.lastDeliveryError,
        issuedAt: certificate.issuedAt,
      })),
    };
  }
}
