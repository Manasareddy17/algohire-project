import jwt from 'jsonwebtoken';
import { IssueBatchCertificatesCommand } from '../src/certificate/commands/impl';
import { prisma } from '../src/database';
import { candidatesCsv, closeTestContext, createSubmittedBatch, createTestContext, review, TestContext } from './helpers';

/** The "things that must never happen" from the brief. */
describe('Things that must never happen', () => {
  let ctx: TestContext;

  afterAll(async () => {
    await prisma.$disconnect();
  });
  let batchId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    batchId = await createSubmittedBatch(ctx, 3);
  });

  afterEach(async () => {
    await closeTestContext(ctx);
  });

  describe('someone acting at a step that is not theirs, or as someone else', () => {
    it.each([
      ['the centre', 'anika', 403],
      ['the quality team', 'neha', 403],
      ['the state office', 'farah', 403],
      ['an officer from another district', 'ravi', 403],
    ])('blocks %s from the district review', async (_label, username, status) => {
      await review(ctx, batchId, username, { decision: 'APPROVE', revision: 1 }).expect(status);
      expect(await prisma.batchReview.count()).toBe(0);
    });

    it('does not count the same officer twice', async () => {
      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 1 }).expect(200);
      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 1 }).expect(409);

      expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('DISTRICT_REVIEW');
    });

    it('ignores a reviewer id smuggled into the request body', async () => {
      const kabir = await prisma.user.findUniqueOrThrow({ where: { username: 'kabir' } });
      await review(ctx, batchId, 'dev', { decision: 'APPROVE', revision: 1, reviewerId: kabir.id }).expect(200);

      const reviews = await prisma.batchReview.findMany({ include: { reviewer: true } });
      expect(reviews.map((row) => row.reviewer.username)).toEqual(['dev']);
    });

    it('rejects a token with a forged signature', async () => {
      const forged = jwt.sign({ sub: '1' }, 'not-the-server-secret');
      await ctx.api.get('/api/batches').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('rejects an unsigned token (alg "none")', async () => {
      const unsigned = jwt.sign({ sub: '1' }, '', { algorithm: 'none' });
      await ctx.api.get('/api/batches').set('Authorization', `Bearer ${unsigned}`).expect(401);
    });

    it('stops a centre from submitting another centre batch', async () => {
      await ctx.api.post(`/api/batches/${batchId}/submit`).set('Authorization', ctx.token('nagpur-centre')).expect(403);
    });

    it('stops anyone but the state office from cancelling a certificate', async () => {
      const certificate = await approveAndIssue();
      await ctx.api
        .post(`/api/certificates/${certificate.id}/revoke`)
        .set('Authorization', ctx.token('dev'))
        .send({ reason: 'I think it is fake' })
        .expect(403);
    });
  });

  describe('a candidate getting two certificates, or two certificates sharing a number', () => {
    it('refuses a second certificate for the same candidate at the database level', async () => {
      const certificate = await approveAndIssue();

      await expect(
        prisma.certificate.create({
          data: { ...certificate, id: undefined, certificateNo: 'PSM-2026-ZZZZZZZZ' },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('refuses a certificate number that is already used', async () => {
      const [first, second] = await approveAndIssueAll();

      await expect(
        prisma.certificate.update({ where: { id: second.id }, data: { certificateNo: first.certificateNo } }),
      ).rejects.toThrow(/Unique constraint/);
    });

    // Bug: the same file uploaded into a second batch while the first was in review was accepted,
    // and approving both gave every candidate two certificates.
    it('refuses to upload candidates who are already in another submitted batch of the course', async () => {
      const second = await ctx.api
        .post('/api/batches')
        .set('Authorization', ctx.token('anika'))
        .send({ courseCode: 'ELEC-101', courseName: 'Assistant Electrician' });

      const response = await ctx.api
        .post(`/api/batches/${second.body.id}/candidates`)
        .set('Authorization', ctx.token('anika'))
        .attach('file', Buffer.from(candidatesCsv(3)), 'same-file.csv')
        .expect(422);

      const firstCode = (await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).code;
      expect(response.body.errors).toHaveLength(3);
      expect(response.body.errors[0].message).toBe(`Already in batch ${firstCode} (DISTRICT_REVIEW) for this course`);
      expect(await prisma.candidate.count({ where: { batchId: second.body.id } })).toBe(0);
    });

    it('refuses to submit a second draft holding the same candidates', async () => {
      // Two drafts get the same people (allowed while nothing is submitted)...
      const createDraft = async () => {
        const created = await ctx.api
          .post('/api/batches')
          .set('Authorization', ctx.token('anika'))
          .send({ courseCode: 'PLMB-201', courseName: 'Plumber General' });
        await ctx.api
          .post(`/api/batches/${created.body.id}/candidates`)
          .set('Authorization', ctx.token('anika'))
          .attach('file', Buffer.from(candidatesCsv(2)), 'drafts.csv')
          .expect(200);
        return created.body.id as string;
      };
      const [draftA, draftB] = [await createDraft(), await createDraft()];

      // ...but only the first one can be submitted.
      await ctx.api.post(`/api/batches/${draftA}/submit`).set('Authorization', ctx.token('anika')).expect(200);
      const response = await ctx.api.post(`/api/batches/${draftB}/submit`).set('Authorization', ctx.token('anika')).expect(422);

      expect(response.body.message).toBe('Some candidates are already in another batch for this course');
      expect((await prisma.batch.findUniqueOrThrow({ where: { id: draftB } })).status).toBe('DRAFT');
    });

    it('issues one certificate per person even if two approved batches hold the same people', async () => {
      // Force the situation the checks above prevent: a second APPROVED batch with the same people.
      const firstCertificates = await approveAndIssueAll();
      const original = await prisma.batch.findUniqueOrThrow({ where: { id: batchId }, include: { candidates: true } });
      const duplicate = await prisma.batch.create({
        data: {
          code: 'B-DUPLICATE',
          centreId: original.centreId,
          courseCode: original.courseCode,
          courseName: original.courseName,
          status: 'APPROVED',
          createdById: original.createdById,
          candidates: {
            create: original.candidates.map(({ rowNumber, enrolmentId, name, phone, score }) => ({ rowNumber, enrolmentId, name, phone, score })),
          },
        },
      });

      const result = await ctx.container.commandBus.execute<{ issued: number }>(new IssueBatchCertificatesCommand(duplicate.id));

      expect(result.issued).toBe(0);
      expect(await prisma.certificate.count({ where: { status: 'ISSUED' } })).toBe(firstCertificates.length);
      expect(await prisma.auditLog.count({ where: { batchId: duplicate.id, action: 'CERTIFICATE_SKIPPED_DUPLICATE' } })).toBe(3);
    });

    it('refuses a second valid certificate for the same person and course at the database level', async () => {
      const [certificate] = await approveAndIssueAll();
      const other = await prisma.batch.create({
        data: {
          code: 'B-OTHER',
          centreId: ctx.ids.puneCentre,
          courseCode: 'ELEC-101',
          courseName: 'Assistant Electrician',
          status: 'APPROVED',
          createdById: certificate.revokedById ?? 1,
          candidates: { create: [{ rowNumber: 2, enrolmentId: certificate.enrolmentId, name: 'Same Person', phone: '+919999999999', score: 80 }] },
        },
        include: { candidates: true },
      });

      await expect(
        prisma.certificate.create({
          data: {
            ...certificate,
            id: undefined,
            certificateNo: 'PSM-2026-ZZZZZZZZ',
            candidateId: other.candidates[0].id,
            batchId: other.id,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('refuses to upload a candidate who already holds a certificate for the course', async () => {
      await approveAndIssue();
      const created = await ctx.api
        .post('/api/batches')
        .set('Authorization', ctx.token('anika'))
        .send({ courseCode: 'ELEC-101', courseName: 'Assistant Electrician' });
      const csv = 'enrolment_id,name,phone,score\nENR-0001,Candidate Bname,9800000001,41';

      const response = await ctx.api
        .post(`/api/batches/${created.body.id}/candidates`)
        .set('Authorization', ctx.token('anika'))
        .attach('file', Buffer.from(csv), 'again.csv')
        .expect(422);
      expect(response.body.errors[0].message).toBe('This candidate already has a certificate for this course');
    });
  });

  describe('a stranger getting hold of someone else certificate or personal details', () => {
    it('refuses a download without the signed link', async () => {
      const certificate = await approveAndIssue();
      await ctx.api.get(`/api/public/certificates/${certificate.certificateNo}/pdf`).expect(403);
      await ctx.api.get(`/api/public/certificates/${certificate.certificateNo}/pdf?token=123.forged`).expect(403);
    });

    it('shows only a masked name on public verification, never the phone', async () => {
      const certificate = await approveAndIssue();
      const response = await ctx.api.get(`/api/public/verify/${certificate.certificateNo}`).expect(200);

      expect(JSON.stringify(response.body)).not.toContain(certificate.phone);
      expect(response.body.candidateName).not.toBe(certificate.candidateName);
      expect(response.body.candidateName).toMatch(/\*/);
    });

    it('hides a batch from a centre that does not own it', async () => {
      await ctx.api.get(`/api/batches/${batchId}`).set('Authorization', ctx.token('nagpur-centre')).expect(404);
    });

    it('hides a batch from an officer of another district', async () => {
      await ctx.api.get(`/api/batches/${batchId}`).set('Authorization', ctx.token('ravi')).expect(404);
      const list = await ctx.api.get('/api/batches').set('Authorization', ctx.token('ravi')).expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('a decision that cannot be traced to who made it and when', () => {
    it('records who made every review decision, and when', async () => {
      await approveAndIssue();

      const reviewed = await prisma.auditLog.findMany({ where: { batchId, action: 'BATCH_REVIEWED' } });
      expect(reviewed).toHaveLength(3);
      for (const entry of reviewed) {
        expect(entry.actorId).not.toBeNull();
        expect(entry.createdAt).toBeInstanceOf(Date);
        expect(entry.correlationId).toBeTruthy();
      }
      const timeline = await ctx.api.get(`/api/batches/${batchId}/timeline`).set('Authorization', ctx.token('farah')).expect(200);
      expect(timeline.body.filter((row: { action: string }) => row.action === 'BATCH_REVIEWED').map((row: { actor: string }) => row.actor)).toEqual([
        'Dev',
        'Meera',
        'Farah',
      ]);
    });
  });

  async function approveAndIssueAll() {
    for (const reviewer of ['dev', 'meera', 'farah']) {
      await review(ctx, batchId, reviewer, { decision: 'APPROVE', revision: 1 }).expect(200);
    }
    await ctx.container.commandBus.execute(new IssueBatchCertificatesCommand(batchId));
    return prisma.certificate.findMany({ where: { batchId } });
  }

  async function approveAndIssue() {
    return (await approveAndIssueAll())[0];
  }
});
