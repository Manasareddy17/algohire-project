import { Queue } from 'bullmq';
import { CacheService } from '../core/cache/cache.service';
import { CommandBus, EventBus, QueryBus } from '../core/cqrs';
import {
  AuditLogDatabaseService,
  BatchDatabaseService,
  CandidateDatabaseService,
  CertificateDatabaseService,
  DataSource,
} from '../database';
import { WhatsAppClient } from '../notification/whatsapp/whatsapp.client';
import {
  DeliverCertificateHandler,
  IssueBatchCertificatesHandler,
  MarkDeliveryFailedHandler,
  RevokeCertificateHandler,
} from './commands/handlers';
import { BatchApprovedHandler, CertificateIssuedHandler } from './events/handlers';
import { FetchCertificateFileHandler, FetchCertificatesHandler, VerifyCertificateHandler } from './queries/handlers';
import { CertificatePdfService } from './services/certificate-pdf.service';
import { DownloadTokenService } from './services/download-token.service';

export interface CertificateModuleDeps {
  commandBus: CommandBus;
  queryBus: QueryBus;
  eventBus: EventBus;
  dataSource: DataSource;
  cacheService: CacheService;
  whatsAppClient: WhatsAppClient;
  storageDir: string;
  publicBaseUrl: string;
  downloadTokenSecret: string;
  deliveryMaxAttempts: number;
  /** Only the worker passes this: it is the one that schedules deliveries. */
  deliveryQueue?: Queue;
}

export function registerCertificateModule(deps: CertificateModuleDeps) {
  const { commandBus, queryBus, eventBus, dataSource, cacheService } = deps;

  const batchDatabaseService = new BatchDatabaseService();
  const candidateDatabaseService = new CandidateDatabaseService();
  const certificateDatabaseService = new CertificateDatabaseService();
  const auditLogDatabaseService = new AuditLogDatabaseService();
  const certificatePdfService = new CertificatePdfService(deps.storageDir, deps.publicBaseUrl);
  const downloadTokenService = new DownloadTokenService(deps.downloadTokenSecret);

  commandBus.register(
    new IssueBatchCertificatesHandler(
      dataSource,
      batchDatabaseService,
      candidateDatabaseService,
      certificateDatabaseService,
      auditLogDatabaseService,
      eventBus,
    ),
    new DeliverCertificateHandler(
      dataSource,
      certificateDatabaseService,
      auditLogDatabaseService,
      certificatePdfService,
      downloadTokenService,
      deps.whatsAppClient,
      eventBus,
      deps.publicBaseUrl,
    ),
    new MarkDeliveryFailedHandler(dataSource, certificateDatabaseService, auditLogDatabaseService, eventBus),
    new RevokeCertificateHandler(dataSource, certificateDatabaseService, auditLogDatabaseService, cacheService, eventBus),
  );

  queryBus.register(
    new VerifyCertificateHandler(certificateDatabaseService, cacheService),
    new FetchCertificateFileHandler(certificateDatabaseService, certificatePdfService, downloadTokenService),
    new FetchCertificatesHandler(certificateDatabaseService),
  );

  eventBus.register(new BatchApprovedHandler(commandBus));
  if (deps.deliveryQueue) {
    eventBus.register(new CertificateIssuedHandler(deps.deliveryQueue, deps.deliveryMaxAttempts));
  }
}
