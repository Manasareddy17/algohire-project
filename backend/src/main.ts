import Redis from 'ioredis';
import { createApp } from './app';
import { buildContainer } from './container';
import { config } from './core/config';
import { Logger } from './core/logger/logger';
import { prisma } from './database';
import { RealtimeService } from './realtime/realtime.service';

const logger = new Logger('Api');

async function bootstrap() {
  const redis = new Redis(config.REDIS_URL);
  const subscriber = new Redis(config.REDIS_URL); // a subscribed connection cannot run other commands

  const container = buildContainer({ redis });
  const realtimeService = new RealtimeService(subscriber);
  await realtimeService.start();

  const server = createApp(container, realtimeService).listen(config.PORT, () => {
    logger.log(`API listening on port ${config.PORT}`);
  });
  if (config.DEMO_LOGIN_ENABLED) {
    logger.warn('DEMO_LOGIN_ENABLED=true: anyone can sign in as any demo user. Never enable this in production.');
  }

  // Stop accepting requests, let in-flight ones finish, then close connections.
  const shutdown = () => {
    logger.log('Shutting down API');
    server.close(async () => {
      await Promise.allSettled([prisma.$disconnect(), redis.quit(), subscriber.quit()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(`API failed to start: ${err.message}`);
  process.exit(1);
});
