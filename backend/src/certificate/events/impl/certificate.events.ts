export class CertificateIssuedEvent {
  static readonly type = 'certificate.issued';
  static readonly aggregateType = 'Certificate';
}

export class CertificateDeliveredEvent {
  static readonly type = 'certificate.delivered';
  static readonly aggregateType = 'Certificate';
}

export class CertificateDeliveryFailedEvent {
  static readonly type = 'certificate.delivery_failed';
  static readonly aggregateType = 'Certificate';
}

export class CertificateRevokedEvent {
  static readonly type = 'certificate.revoked';
  static readonly aggregateType = 'Certificate';
}

export interface CertificateEventPayload extends Record<string, unknown> {
  certificateId: string;
  certificateNo: string;
  batchId: string;
  centreId: number;
  districtId: number;
}
