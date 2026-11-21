export { BatchStatus, ReviewDecision, ReviewStage } from '@prisma/client';

/** Statuses in which the centre may edit candidates and (re)submit. */
export const EDITABLE_STATUSES = ['DRAFT', 'SENT_BACK'] as const;

export const PASS_MARK = 40;
export const MAX_CANDIDATES_PER_BATCH = 1000;
