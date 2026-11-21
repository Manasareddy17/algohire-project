import { Role } from '@prisma/client';
import { Router } from 'express';
import multer from 'multer';
import { requireRoles } from '../auth/auth.middleware';
import { CommandBus, QueryBus } from '../core/cqrs';
import { BadRequestException } from '../core/exceptions';
import { Logger } from '../core/logger/logger';
import { parseBody, parseUuid } from '../middlewares/validate';
import { CreateBatchCommand, ReviewBatchCommand, SubmitBatchCommand, UploadCandidatesCommand } from './commands/impl';
import { createBatchSchema, fetchBatchesSchema, reviewBatchSchema } from './dto/batch-request.dto';
import {
  FetchBatchTimelineQuery,
  FetchBatchesQuery,
  FetchOneBatchQuery,
  FetchPendingReviewsQuery,
  FetchStuckBatchesQuery,
} from './queries/impl';

// Files are kept in memory (max 2 MB) and never written to disk unvalidated.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

/** Controllers only validate input and hand over to the command/query bus. All rules live in handlers. */
export function createBatchRouter(commandBus: CommandBus, queryBus: QueryBus) {
  const router = Router();
  const logger = new Logger('BatchController');

  router.get('/', async (req, res) => {
    const filter = parseBody(fetchBatchesSchema, req.query);
    res.json(await queryBus.execute(new FetchBatchesQuery(filter, req.user!)));
  });

  router.get('/pending-reviews', async (req, res) => {
    res.json(await queryBus.execute(new FetchPendingReviewsQuery(req.user!)));
  });

  router.get('/stuck', requireRoles(Role.STATE), async (req, res) => {
    res.json(await queryBus.execute(new FetchStuckBatchesQuery(req.user!)));
  });

  router.get('/:id', async (req, res) => {
    const batchId = parseUuid(req.params.id, 'batch id');
    res.json(await queryBus.execute(new FetchOneBatchQuery(batchId, req.user!)));
  });

  router.get('/:id/timeline', async (req, res) => {
    const batchId = parseUuid(req.params.id, 'batch id');
    res.json(await queryBus.execute(new FetchBatchTimelineQuery(batchId, req.user!)));
  });

  router.post('/', requireRoles(Role.CENTRE), async (req, res) => {
    const body = parseBody(createBatchSchema, req.body);
    logger.debug(`[CreateBatch] data: ${JSON.stringify(body)}`);
    res.status(201).json(await commandBus.execute(new CreateBatchCommand(body, req.user!)));
  });

  router.post('/:id/candidates', requireRoles(Role.CENTRE), upload.single('file'), async (req, res) => {
    const batchId = parseUuid(req.params.id, 'batch id');
    if (!req.file) throw new BadRequestException('Attach the spreadsheet as "file"');
    const file = { buffer: req.file.buffer, originalName: req.file.originalname };
    res.json(await commandBus.execute(new UploadCandidatesCommand(batchId, file, req.user!)));
  });

  router.post('/:id/submit', requireRoles(Role.CENTRE), async (req, res) => {
    const batchId = parseUuid(req.params.id, 'batch id');
    res.json(await commandBus.execute(new SubmitBatchCommand(batchId, req.user!)));
  });

  router.post(
    '/:id/reviews',
    requireRoles(Role.DISTRICT_OFFICER, Role.QUALITY, Role.STATE),
    async (req, res) => {
      const batchId = parseUuid(req.params.id, 'batch id');
      const body = parseBody(reviewBatchSchema, req.body);
      res.json(await commandBus.execute(new ReviewBatchCommand(batchId, body, req.user!)));
    },
  );

  return router;
}
