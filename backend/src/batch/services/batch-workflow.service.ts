import { BatchStatus, ReviewDecision, ReviewStage, Role } from '@prisma/client';
import { ForbiddenException } from '../../core/exceptions';
import { UserResponse } from '../../core/interfaces/user.interface';

export interface WorkflowOptions {
  districtApprovalsRequired: number;
  qualityReviewThreshold: number;
}

export interface BatchScope {
  status: BatchStatus;
  centreId: number;
  centre: { districtId: number };
}

const STAGE_BY_STATUS: Partial<Record<BatchStatus, ReviewStage>> = {
  [BatchStatus.DISTRICT_REVIEW]: ReviewStage.DISTRICT,
  [BatchStatus.QUALITY_REVIEW]: ReviewStage.QUALITY,
  [BatchStatus.STATE_REVIEW]: ReviewStage.STATE,
};

const ROLE_BY_STAGE: Record<ReviewStage, Role> = {
  [ReviewStage.DISTRICT]: Role.DISTRICT_OFFICER,
  [ReviewStage.QUALITY]: Role.QUALITY,
  [ReviewStage.STATE]: Role.STATE,
};

/**
 * The approval workflow as pure rules: no database, no I/O. Handlers ask it
 * "who may act here" and "where does the batch go next", which keeps the rules in one place
 * and unit-testable on their own.
 *
 *   DRAFT -> DISTRICT_REVIEW -(N officers)-> [QUALITY_REVIEW if large] -> STATE_REVIEW -> APPROVED
 *   any review stage -(send back)-> SENT_BACK -(resubmit, revision+1)-> DISTRICT_REVIEW
 *   any review stage -(reject quorum)-> REJECTED
 */
export class BatchWorkflowService {
  constructor(private readonly options: WorkflowOptions) {}

  stageForStatus(status: BatchStatus): ReviewStage | null {
    return STAGE_BY_STATUS[status] ?? null;
  }

  /** How many matching decisions a stage needs. Only the district stage needs a quorum. */
  decisionsRequired(stage: ReviewStage): number {
    return stage === ReviewStage.DISTRICT ? this.options.districtApprovalsRequired : 1;
  }

  /** A single send back is enough at any stage: it ends nothing, the centre just fixes and resubmits. */
  isImmediate(decision: ReviewDecision): boolean {
    return decision === ReviewDecision.SEND_BACK;
  }

  statusAfterApproval(stage: ReviewStage, candidateCount: number): BatchStatus {
    switch (stage) {
      case ReviewStage.DISTRICT:
        return candidateCount > this.options.qualityReviewThreshold
          ? BatchStatus.QUALITY_REVIEW
          : BatchStatus.STATE_REVIEW;
      case ReviewStage.QUALITY:
        return BatchStatus.STATE_REVIEW;
      case ReviewStage.STATE:
        return BatchStatus.APPROVED;
    }
  }

  statusAfterDecision(stage: ReviewStage, decision: ReviewDecision, candidateCount: number): BatchStatus {
    if (decision === ReviewDecision.SEND_BACK) return BatchStatus.SENT_BACK;
    if (decision === ReviewDecision.REJECT) return BatchStatus.REJECTED;
    return this.statusAfterApproval(stage, candidateCount);
  }

  /** Throws unless `user` is the right person to act on this batch at this stage. */
  assertCanReview(user: UserResponse, batch: BatchScope, stage: ReviewStage): void {
    if (user.role !== ROLE_BY_STAGE[stage]) {
      throw new ForbiddenException(`Only ${ROLE_BY_STAGE[stage]} users can act at the ${stage} stage`);
    }
    if (stage === ReviewStage.DISTRICT && user.districtId !== batch.centre.districtId) {
      throw new ForbiddenException('This batch belongs to a different district');
    }
  }

  assertCentreOwnsBatch(user: UserResponse, batch: BatchScope): void {
    if (user.role !== Role.CENTRE || user.centreId !== batch.centreId) {
      throw new ForbiddenException('Only the training centre that owns this batch can do this');
    }
  }

  canView(user: UserResponse, batch: BatchScope): boolean {
    switch (user.role) {
      case Role.CENTRE:
        return user.centreId === batch.centreId;
      case Role.DISTRICT_OFFICER:
        return user.districtId === batch.centre.districtId;
      case Role.QUALITY:
      case Role.STATE:
        return true;
    }
  }
}
