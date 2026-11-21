import { Role } from '@prisma/client';
import { Router } from 'express';
import Redis from 'ioredis';
import { z } from 'zod';
import { requireRoles } from '../auth/auth.middleware';
import { CommandBus, QueryBus } from '../core/cqrs';
import { parseBody, parseUuid } from '../middlewares/validate';
import { rateLimit } from '../middlewares/rate-limit';
import { RevokeCertificateCommand } from './commands/impl';
import { FetchCertificateFileQuery, FetchCertificatesQuery, VerifyCertificateQuery } from './queries/impl';

const revokeSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const searchSchema = z.object({
  batchId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});

/** Staff routes (logged in). */
export function createCertificateRouter(commandBus: CommandBus, queryBus: QueryBus) {
  const router = Router();

  router.get('/', async (req, res) => {
    const filter = parseBody(searchSchema, req.query);
    res.json(await queryBus.execute(new FetchCertificatesQuery(filter, req.user!)));
  });

  router.post('/:id/revoke', requireRoles(Role.STATE), async (req, res) => {
    const certificateId = parseUuid(req.params.id, 'certificate id');
    const { reason } = parseBody(revokeSchema, req.body);
    res.json(await commandBus.execute(new RevokeCertificateCommand(certificateId, reason, req.user!)));
  });

  return router;
}

/** Public routes: no login, rate limited per IP. */
export function createPublicCertificateRouter(queryBus: QueryBus, redis: Redis) {
  const router = Router();

  router.get('/verify/:certificateNo', rateLimit(redis, 'verify', 60), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await queryBus.execute(new VerifyCertificateQuery(String(req.params.certificateNo).slice(0, 40))));
  });

  router.get('/certificates/:certificateNo/pdf', rateLimit(redis, 'download', 30), async (req, res) => {
    const { filePath, fileName } = await queryBus.execute<{ filePath: string; fileName: string }>(
      new FetchCertificateFileQuery(String(req.params.certificateNo).slice(0, 40), String(req.query.token ?? '')),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(filePath, fileName);
  });

  return router;
}
