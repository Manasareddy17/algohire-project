export { BatchStatus, ReviewDecision, ReviewStage } from '@prisma/client';

/** Statuses in which a batch is waiting for a reviewer. */
export const REVIEW_STATUSES = ['DISTRICT_REVIEW', 'QUALITY_REVIEW', 'STATE_REVIEW'] as const;

/** Statuses in which the centre may edit candidates and (re)submit. */
export const EDITABLE_STATUSES = ['DRAFT', 'SENT_BACK'] as const;

export const PASS_MARK = 40;
export const MAX_CANDIDATES_PER_BATCH = 1000;
