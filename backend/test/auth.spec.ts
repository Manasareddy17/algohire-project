import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/database';
import { closeTestContext, createTestContext, TestContext } from './helpers';

describe('createAuthRouter', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await closeTestContext(ctx);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('with the demo login enabled', () => {
    it('lists the demo users and signs in as the picked person', async () => {
      const api = request(createApp(ctx.container, undefined, { demoLoginEnabled: true }));

      const users = await api.get('/api/auth/demo-users').expect(200);
      const login = await api.post('/api/auth/login').send({ username: 'Dev' }).expect(200);

      expect(users.body.map((user: { username: string }) => user.username)).toContain('dev');
      expect(login.body.user).toMatchObject({ username: 'dev', role: 'DISTRICT_OFFICER' });
    });

    it('rejects an unknown user', async () => {
      const api = request(createApp(ctx.container, undefined, { demoLoginEnabled: true }));

      await api.post('/api/auth/login').send({ username: 'mallory' }).expect(401);
    });
  });

  describe('with the demo login disabled (production)', () => {
    it.each([
      ['GET', '/api/auth/demo-users'],
      ['POST', '/api/auth/login'],
    ])('does not expose %s %s at all', async (method, path) => {
      const api = request(createApp(ctx.container, undefined, { demoLoginEnabled: false }));

      const response = method === 'GET' ? await api.get(path) : await api.post(path).send({ username: 'farah' });

      expect(response.status).toBe(404);
      expect(response.body.token).toBeUndefined();
    });

    // A token issued by the real sign-in keeps working: only the password-less shortcut is gone.
    it('still accepts a valid token for the protected API', async () => {
      const api = request(createApp(ctx.container, undefined, { demoLoginEnabled: false }));

      const me = await api.get('/api/auth/me').set('Authorization', ctx.token('farah')).expect(200);

      expect(me.body).toMatchObject({ username: 'farah', role: 'STATE' });
    });
  });
});
