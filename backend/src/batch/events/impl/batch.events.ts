// Event classes carry only their routing identity; the payload travels as JSON through the outbox.
export class BatchSubmittedEvent {
  static readonly type = 'batch.submitted';
  static readonly aggregateType = 'Batch';
}

export class BatchReviewedEvent {
  static readonly type = 'batch.reviewed';
  static readonly aggregateType = 'Batch';
}

export class BatchStageChangedEvent {
  static readonly type = 'batch.stage_changed';
  static readonly aggregateType = 'Batch';
}

export class BatchApprovedEvent {
  static readonly type = 'batch.approved';
  static readonly aggregateType = 'Batch';
}

export class BatchSentBackEvent {
  static readonly type = 'batch.sent_back';
  static readonly aggregateType = 'Batch';
}

export class BatchRejectedEvent {
  static readonly type = 'batch.rejected';
  static readonly aggregateType = 'Batch';
}

export class BatchEscalatedEvent {
  static readonly type = 'batch.escalated';
  static readonly aggregateType = 'Batch';
}

/** Common payload of batch events: enough for the realtime layer to decide who may see it. */
export interface BatchEventPayload extends Record<string, unknown> {
  batchId: string;
  code: string;
  status: string;
  revision: number;
  centreId: number;
  districtId: number;
}

export function toBatchEventPayload(
  batch: { id: string; code: string; centreId: number; centre: { districtId: number } },
  status: string,
  revision: number,
  extra: Record<string, unknown> = {},
): BatchEventPayload {
  return {
    batchId: batch.id,
    code: batch.code,
    status,
    revision,
    centreId: batch.centreId,
    districtId: batch.centre.districtId,
    ...extra,
  };
}
