import { DefaultJobOptions } from 'bullmq';

export const QueueNames = {
  DomainEvents: 'domain-events',
  CertificateDelivery: 'certificate-delivery',
  Maintenance: 'maintenance',
} as const;

/**
 * Finished jobs are kept for a day: while a job is kept, adding another job with the same
 * jobId is ignored. That is what turns "the same event published twice" into one job.
 */
export const defaultJobOptions: DefaultJobOptions = {
  removeOnComplete: { age: 24 * 3600, count: 50_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
