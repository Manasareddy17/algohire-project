import { Role } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { createApp } from '../src/app';
import { JwtService } from '../src/auth/jwt.service';
import { buildContainer, Container } from '../src/container';
import { config } from '../src/core/config';
import { prisma } from '../src/database';
import { SendDocumentRequest, WhatsAppClient, WhatsAppError } from '../src/notification/whatsapp/whatsapp.client';

/**
 * Behaves like the real provider: sometimes fails before sending, sometimes sends but the
 * answer is lost (the caller sees a timeout). Honours the idempotency key like the mock service.
 */
export class FlakyWhatsAppClient extends WhatsAppClient {
  readonly inbox = new Map<string, string[]>();
  private readonly sentByKey = new Map<string, string>();
  calls = 0;

  constructor(private readonly behaviour: () => 'fail' | 'lost' | 'ok' = () => 'ok') {
    super('http://unused', 1000);
  }

  async sendDocument(request: SendDocumentRequest) {
    this.calls++;
    const existing = this.sentByKey.get(request.idempotencyKey);
    if (existing) return { messageId: existing };

    const outcome = this.behaviour();
    if (outcome === 'fail') throw new WhatsAppError('WhatsApp is unavailable (HTTP 500)', true);

    const messageId = `wamid.${this.calls}`;
    this.sentByKey.set(request.idempotencyKey, messageId);
    this.inbox.set(request.to, [...(this.inbox.get(request.to) ?? []), messageId]);
    if (outcome === 'lost') throw new WhatsAppError('WhatsApp request failed: timed out after 1000ms', true);
    return { messageId };
  }
}

export interface TestContext {
  container: Container;
  api: ReturnType<typeof request>;
  redis: Redis;
  whatsApp: FlakyWhatsAppClient;
  token: (username: string) => string;
  ids: { puneCentre: number; nagpurCentre: number };
}

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events, audit_logs, certificates, batch_reviews, candidates, batches, users, training_centres, districts RESTART IDENTITY CASCADE',
  );
}

export async function createTestContext(whatsApp = new FlakyWhatsAppClient()): Promise<TestContext> {
  await resetDatabase();
  const redis = new Redis(config.REDIS_URL);
  await redis.flushdb();

  const pune = await prisma.district.create({ data: { name: 'Pune' } });
  const nagpur = await prisma.district.create({ data: { name: 'Nagpur' } });
  const puneCentre = await prisma.trainingCentre.create({ data: { code: 'PUN-1', name: 'Pune Centre', districtId: pune.id } });
  const nagpurCentre = await prisma.trainingCentre.create({ data: { code: 'NAG-1', name: 'Nagpur Centre', districtId: nagpur.id } });
  await prisma.user.createMany({
    data: [
      { username: 'anika', name: 'Anika', role: Role.CENTRE, centreId: puneCentre.id, districtId: pune.id },
      { username: 'nagpur-centre', name: 'Nagpur Centre User', role: Role.CENTRE, centreId: nagpurCentre.id, districtId: nagpur.id },
      { username: 'dev', name: 'Dev', role: Role.DISTRICT_OFFICER, districtId: pune.id },
      { username: 'meera', name: 'Meera', role: Role.DISTRICT_OFFICER, districtId: pune.id },
      { username: 'kabir', name: 'Kabir', role: Role.DISTRICT_OFFICER, districtId: pune.id },
      { username: 'ravi', name: 'Ravi (Nagpur officer)', role: Role.DISTRICT_OFFICER, districtId: nagpur.id },
      { username: 'neha', name: 'Neha', role: Role.QUALITY },
      { username: 'farah', name: 'Farah', role: Role.STATE },
    ],
  });
  const users = await prisma.user.findMany();
  const idByUsername = new Map(users.map((user) => [user.username, user.id]));
  const jwtService = new JwtService(config.JWT_SECRET);

  const container = buildContainer({ redis, whatsAppClient: whatsApp });
  return {
    container,
    api: request(createApp(container)),
    redis,
    whatsApp,
    token: (username) => `Bearer ${jwtService.sign(idByUsername.get(username)!)}`,
    ids: { puneCentre: puneCentre.id, nagpurCentre: nagpurCentre.id },
  };
}

/** A CSV with `count` valid, distinct candidates. */
export function candidatesCsv(count: number, startAt = 1): string {
  const rows = ['enrolment_id,name,phone,score'];
  for (let i = startAt; i < startAt + count; i++) {
    const letters = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26) % 26);
    rows.push(`ENR-${String(i).padStart(4, '0')},Candidate ${letters}name,9${String(800000000 + i)},${40 + (i % 60)}`);
  }
  return rows.join('\n');
}

/** Centre creates a batch, uploads `count` candidates and submits it. Returns the batch id. */
export async function createSubmittedBatch(ctx: TestContext, count: number, username = 'anika'): Promise<string> {
  const created = await ctx.api
    .post('/api/batches')
    .set('Authorization', ctx.token(username))
    .send({ courseCode: 'ELEC-101', courseName: 'Assistant Electrician' })
    .expect(201);
  const batchId = created.body.id as string;

  await ctx.api
    .post(`/api/batches/${batchId}/candidates`)
    .set('Authorization', ctx.token(username))
    .attach('file', Buffer.from(candidatesCsv(count)), 'batch.csv')
    .expect(200);
  await ctx.api.post(`/api/batches/${batchId}/submit`).set('Authorization', ctx.token(username)).expect(200);
  return batchId;
}

export function review(ctx: TestContext, batchId: string, username: string, body: object) {
  return ctx.api.post(`/api/batches/${batchId}/reviews`).set('Authorization', ctx.token(username)).send(body);
}

export async function closeTestContext(ctx: TestContext) {
  await ctx.redis.quit();
}
