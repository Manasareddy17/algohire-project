import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authenticate } from './auth/auth.middleware';
import { createAuthRouter } from './auth/auth.controller';
import { JwtService } from './auth/jwt.service';
import { createBatchRouter } from './batch/batch.controller';
import { createCertificateRouter, createPublicCertificateRouter } from './certificate/certificate.controller';
import { Container } from './container';
import { config } from './core/config';
import { prisma } from './database';
import { correlationId } from './middlewares/correlation-id';
import { errorHandler } from './middlewares/error-handler';
import { RealtimeService } from './realtime/realtime.service';

export interface AppOptions {
  demoLoginEnabled: boolean;
}

export function createApp(
  container: Container,
  realtimeService?: RealtimeService,
  options: AppOptions = { demoLoginEnabled: config.DEMO_LOGIN_ENABLED },
) {
  const { commandBus, queryBus, redis, userDatabaseService } = container;
  const jwtService = new JwtService(config.JWT_SECRET);
  const requireLogin = authenticate(jwtService, userDatabaseService);

  const app = express();
  app.set('trust proxy', 1); // behind nginx: req.ip is the real client IP
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use(correlationId);

  app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  // Public (no login)
  app.use('/api/auth', createAuthRouter(jwtService, userDatabaseService, options.demoLoginEnabled));
  app.use('/api/public', createPublicCertificateRouter(queryBus, redis));

  // Staff (login required)
  app.use('/api/batches', requireLogin, createBatchRouter(commandBus, queryBus));
  app.use('/api/certificates', requireLogin, createCertificateRouter(commandBus, queryBus));

  if (realtimeService) {
    app.get('/api/events', requireLogin, (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
      });
      res.write('event: ready\ndata: {}\n\n');
      realtimeService.addClient(req.user!, res);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
      res.on('close', () => clearInterval(keepAlive));
    });
  }

  app.use(errorHandler);
  return app;
}
