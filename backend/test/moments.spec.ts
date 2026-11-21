import { BatchStatus, CertificateStatus, DeliveryStatus } from '@prisma/client';
import { EscalateStuckBatchesCommand } from '../src/batch/commands/impl';
import { DeliverCertificateCommand, IssueBatchCertificatesCommand } from '../src/certificate/commands/impl';
import { prisma } from '../src/database';
import {
  closeTestContext,
  createSubmittedBatch,
  createTestContext,
  FlakyWhatsAppClient,
  review,
  TestContext,
} from './helpers';

/**
 * The six "moments that must work" from the brief, against a real Postgres and Redis.
 */
describe('Moments that must work', () => {
  let ctx: TestContext;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await closeTestContext(ctx);
  });

  describe('Moment 1: upload with bad rows', () => {
    beforeEach(async () => {
      ctx = await createTestContext();
    });

    it('lists every bad row and saves nothing', async () => {
      const created = await ctx.api
        .post('/api/batches')
        .set('Authorization', ctx.token('anika'))
        .send({ courseCode: 'ELEC-101', courseName: 'Assistant Electrician' })
        .expect(201);
      const csv = [
        'enrolment_id,name,phone,score',
        'ENR-1,Ravi Kumar,9876543210,78',
        'ENR-2,Priya Sharma,12345,85',
        'ENR-3,=HYPERLINK("x"),9876543212,64',
        'ENR-1,Arjun Patil,9876543213,30',
      ].join('\n');

      const response = await ctx.api
        .post(`/api/batches/${created.body.id}/candidates`)
        .set('Authorization', ctx.token('anika'))
        .attach('file', Buffer.from(csv), 'batch.csv')
        .expect(422);

      expect(response.body.message).toBe('The file has errors. Nothing was saved.');
      expect(response.body.errors.map((error: { row: number; column: string }) => [error.row, error.column])).toEqual([
        [3, 'phone'],
        [4, 'name'],
        [5, 'enrolment_id'],
        [5, 'score'],
      ]);
      expect(await prisma.candidate.count()).toBe(0);
    });

    it('keeps the previous candidate list when a corrected upload still has errors', async () => {
      const batchId = (
        await ctx.api
          .post('/api/batches')
          .set('Authorization', ctx.token('anika'))
          .send({ courseCode: 'ELEC-101', courseName: 'Assistant Electrician' })
      ).body.id;
      const good = 'enrolment_id,name,phone,score\nENR-1,Ravi Kumar,9876543210,78\nENR-2,Priya Sharma,9876543211,85';
      const bad = 'enrolment_id,name,phone,score\nENR-9,Ravi Kumar,9876543219,78\nENR-10,X,1,1';

      await ctx.api.post(`/api/batches/${batchId}/candidates`).set('Authorization', ctx.token('anika'))
        .attach('file', Buffer.from(good), 'good.csv').expect(200);
      await ctx.api.post(`/api/batches/${batchId}/candidates`).set('Authorization', ctx.token('anika'))
        .attach('file', Buffer.from(bad), 'bad.csv').expect(422);

      const candidates = await prisma.candidate.findMany({ where: { batchId }, orderBy: { rowNumber: 'asc' } });
      expect(candidates.map((candidate) => candidate.enrolmentId)).toEqual(['ENR-1', 'ENR-2']);
    });
  });

  describe('Moment 2: two officers approve at the same moment', () => {
    beforeEach(async () => {
      ctx = await createTestContext();
    });

    it('moves the batch forward exactly once', async () => {
      const batchId = await createSubmittedBatch(ctx, 5);

      const responses = await Promise.all(
        ['dev', 'meera', 'kabir'].map((officer) => review(ctx, batchId, officer, { decision: 'APPROVE', revision: 1 })),
      );

      // Two approvals complete the quorum; the third arrives after the batch moved on.
      expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 409]);
      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.status).toBe(BatchStatus.STATE_REVIEW);
      expect(await prisma.auditLog.count({ where: { batchId, action: 'BATCH_STAGE_CHANGED' } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: batchId, type: 'batch.stage_changed' } })).toBe(1);
    });
  });

  describe('Moment 3: 60 candidates, unreliable WhatsApp', () => {
    it('gives every candidate exactly one certificate and exactly one message', async () => {
      let call = 0;
      // Every 3rd call fails before sending, every 3rd+1 sends but the answer is lost.
      const whatsApp = new FlakyWhatsAppClient(() => (['fail', 'lost', 'ok'] as const)[call++ % 3]);
      ctx = await createTestContext(whatsApp);
      const batchId = await createSubmittedBatch(ctx, 60);

      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 1 }).expect(200);
      await review(ctx, batchId, 'meera', { decision: 'APPROVE', revision: 1 }).expect(200);
      // 60 > 50 candidates: the quality team must look at it.
      expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe(BatchStatus.QUALITY_REVIEW);
      await review(ctx, batchId, 'neha', { decision: 'APPROVE', revision: 1 }).expect(200);
      await review(ctx, batchId, 'farah', { decision: 'APPROVE', revision: 1 }).expect(200);

      // The approved event is handled twice at once (duplicate delivery from the queue).
      const { commandBus } = ctx.container;
      await Promise.allSettled([
        commandBus.execute(new IssueBatchCertificatesCommand(batchId)),
        commandBus.execute(new IssueBatchCertificatesCommand(batchId)),
      ]);
      await commandBus.execute(new IssueBatchCertificatesCommand(batchId)); // and once more later

      const certificates = await prisma.certificate.findMany({ where: { batchId } });
      expect(certificates).toHaveLength(60);
      expect(new Set(certificates.map((certificate) => certificate.certificateNo)).size).toBe(60);
      expect(await prisma.outboxEvent.count({ where: { type: 'certificate.issued' } })).toBe(60);

      // Simulate the queue: retry each delivery until it succeeds.
      for (const certificate of certificates) {
        for (let attempt = 1; attempt <= 8; attempt++) {
          try {
            await commandBus.execute(new DeliverCertificateCommand(certificate.id));
            break;
          } catch {
            // retried by BullMQ in production
          }
        }
        await commandBus.execute(new DeliverCertificateCommand(certificate.id)); // a late duplicate job
      }

      const delivered = await prisma.certificate.findMany({ where: { batchId } });
      expect(delivered.every((certificate) => certificate.deliveryStatus === DeliveryStatus.SENT)).toBe(true);
      expect(whatsApp.inbox.size).toBe(60);
      expect([...whatsApp.inbox.values()].every((messages) => messages.length === 1)).toBe(true);
    });
  });

  describe('Moment 4: a cancelled certificate is no longer valid', () => {
    it('shows REVOKED right after cancelling, even if the valid answer was cached', async () => {
      ctx = await createTestContext();
      const batchId = await createSubmittedBatch(ctx, 2);
      for (const reviewer of ['dev', 'meera', 'farah']) {
        await review(ctx, batchId, reviewer, { decision: 'APPROVE', revision: 1 }).expect(200);
      }
      await ctx.container.commandBus.execute(new IssueBatchCertificatesCommand(batchId));
      const certificate = await prisma.certificate.findFirstOrThrow({ where: { batchId } });

      const before = await ctx.api.get(`/api/public/verify/${certificate.certificateNo}`).expect(200);
      expect(before.body.result).toBe('VALID'); // now cached in Redis

      await ctx.api
        .post(`/api/certificates/${certificate.id}/revoke`)
        .set('Authorization', ctx.token('farah'))
        .send({ reason: 'Reported as fake by an employer' })
        .expect(200);

      const after = await ctx.api.get(`/api/public/verify/${certificate.certificateNo}`).expect(200);
      expect(after.body.result).toBe('REVOKED');
      expect((await prisma.certificate.findUniqueOrThrow({ where: { id: certificate.id } })).status).toBe(
        CertificateStatus.REVOKED,
      );
    });
  });

  describe('Moment 5: a batch sits with an officer for too long', () => {
    it('escalates it to the state office once, without anyone chasing it', async () => {
      ctx = await createTestContext();
      const batchId = await createSubmittedBatch(ctx, 3);
      await prisma.batch.update({ where: { id: batchId }, data: { stageEnteredAt: new Date(Date.now() - 3 * 24 * 3600_000) } });

      // Two worker instances run the SLA scan at the same moment.
      await Promise.all([
        ctx.container.commandBus.execute(new EscalateStuckBatchesCommand()),
        ctx.container.commandBus.execute(new EscalateStuckBatchesCommand()),
      ]);

      expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).escalatedAt).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { batchId, action: 'BATCH_ESCALATED' } })).toBe(1);
      const stuck = await ctx.api.get('/api/batches/stuck').set('Authorization', ctx.token('farah')).expect(200);
      expect(stuck.body.map((batch: { id: string }) => batch.id)).toEqual([batchId]);
    });
  });

  describe('Moment 6: send back, fix and resend', () => {
    it('starts a new revision in which earlier approvals no longer count', async () => {
      ctx = await createTestContext();
      const batchId = await createSubmittedBatch(ctx, 3);

      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 1 }).expect(200);
      await review(ctx, batchId, 'kabir', { decision: 'SEND_BACK', reason: 'Row 3 phone number is wrong', revision: 1 }).expect(200);
      expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe(BatchStatus.SENT_BACK);

      await ctx.api.post(`/api/batches/${batchId}/submit`).set('Authorization', ctx.token('anika')).expect(200);
      const resubmitted = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
      expect(resubmitted).toMatchObject({ status: BatchStatus.DISTRICT_REVIEW, revision: 2 });

      // Dev's revision-1 approval is not carried over: Meera alone is not a quorum.
      const meera = await review(ctx, batchId, 'meera', { decision: 'APPROVE', revision: 2 }).expect(200);
      expect(meera.body.data).toMatchObject({ status: BatchStatus.DISTRICT_REVIEW, count: 1, required: 2 });

      // Approving the stale revision is refused; approving the current one completes the quorum.
      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 1 }).expect(409);
      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 2 }).expect(200);
      expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe(BatchStatus.STATE_REVIEW);
    });
  });
});
