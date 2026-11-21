import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { registerBatchModule } from './batch/batch.module';
import { registerCertificateModule } from './certificate/certificate.module';
import { CacheService } from './core/cache/cache.service';
import { config } from './core/config';
import { CommandBus, EventBus, QueryBus } from './core/cqrs';
import { dataSource, UserDatabaseService } from './database';
import { WhatsAppClient } from './notification/whatsapp/whatsapp.client';

export interface Container {
  commandBus: CommandBus;
  queryBus: QueryBus;
  eventBus: EventBus;
  redis: Redis;
  cacheService: CacheService;
  userDatabaseService: UserDatabaseService;
}

/** Builds every module once. Used by the API (main.ts), the worker (worker.ts) and the tests. */
export function buildContainer(options: { redis: Redis; deliveryQueue?: Queue; whatsAppClient?: WhatsAppClient }): Container {
  const commandBus = new CommandBus();
  const queryBus = new QueryBus();
  const eventBus = new EventBus();
  const cacheService = new CacheService(options.redis);

  registerBatchModule({
    commandBus,
    queryBus,
    eventBus,
    dataSource,
    slaMinutes: config.SLA_MINUTES,
    districtApprovalsRequired: config.DISTRICT_APPROVALS_REQUIRED,
    qualityReviewThreshold: config.QUALITY_REVIEW_THRESHOLD,
  });

  registerCertificateModule({
    commandBus,
    queryBus,
    eventBus,
    dataSource,
    cacheService,
    whatsAppClient: options.whatsAppClient ?? new WhatsAppClient(config.WHATSAPP_API_URL, config.WHATSAPP_TIMEOUT_MS),
    storageDir: config.CERTIFICATE_STORAGE_DIR,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    downloadTokenSecret: config.DOWNLOAD_TOKEN_SECRET,
    deliveryMaxAttempts: config.DELIVERY_MAX_ATTEMPTS,
    deliveryQueue: options.deliveryQueue,
  });

  return {
    commandBus,
    queryBus,
    eventBus,
    redis: options.redis,
    cacheService,
    userDatabaseService: new UserDatabaseService(),
  };
}
