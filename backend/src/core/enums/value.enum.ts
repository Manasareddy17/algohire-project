export enum Modules {
  Batch = 'Batch',
  Certificate = 'Certificate',
}

export enum ActionType {
  Created = 'created',
  Uploaded = 'uploaded',
  Submitted = 'submitted',
  Approved = 'approved',
  SentBack = 'sent back',
  Rejected = 'rejected',
  Revoked = 'revoked',
}

/** Actions written to the audit log. */
export enum AuditAction {
  BatchCreated = 'BATCH_CREATED',
  CandidatesUploaded = 'CANDIDATES_UPLOADED',
  BatchSubmitted = 'BATCH_SUBMITTED',
  BatchReviewed = 'BATCH_REVIEWED',
  BatchStageChanged = 'BATCH_STAGE_CHANGED',
  BatchEscalated = 'BATCH_ESCALATED',
  CertificateIssued = 'CERTIFICATE_ISSUED',
  CertificateDelivered = 'CERTIFICATE_DELIVERED',
  CertificateDeliveryFailed = 'CERTIFICATE_DELIVERY_FAILED',
  CertificateRevoked = 'CERTIFICATE_REVOKED',
}
