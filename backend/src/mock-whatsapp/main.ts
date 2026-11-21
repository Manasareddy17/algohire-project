import { randomUUID } from 'node:crypto';
import express from 'express';
import Redis from 'ioredis';

/**
 * Stand-in for the WhatsApp Business API. It misbehaves on purpose, like the real thing:
 *  - MOCK_FAILURE_RATE        -> HTTP 500, message NOT sent
 *  - MOCK_TIMEOUT_RATE        -> hangs (client times out), message NOT sent
 *  - MOCK_LOST_RESPONSE_RATE  -> message IS sent, but the response never arrives (the hard case)
 *  - POST /admin/outage {"enabled":true} -> every call returns 503 (WhatsApp outage drill)
 * Messages are de-duplicated by the Idempotency-Key header and kept in Redis,
 * so GET /v1/inbox/:phone shows exactly what each "phone" received.
 */
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const port = Number(process.env.MOCK_WHATSAPP_PORT || 4001);
const failureRate = Number(process.env.MOCK_FAILURE_RATE || 0.2);
const timeoutRate = Number(process.env.MOCK_TIMEOUT_RATE || 0.1);
const lostResponseRate = Number(process.env.MOCK_LOST_RESPONSE_RATE || 0.1);
const HANG_MS = 15_000;

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/v1/messages', async (req, res) => {
  if ((await redis.get('mockwa:outage')) === '1') {
    res.status(503).json({ error: 'Service unavailable (simulated outage)' });
    return;
  }

  const idempotencyKey = req.header('Idempotency-Key');
  const { to, document, caption } = req.body ?? {};
  if (!idempotencyKey || !to || !document?.link) {
    res.status(400).json({ error: 'to, document.link and Idempotency-Key are required' });
    return;
  }

  // Already delivered with this key? Return the same message id, do not send again.
  const existing = await redis.get(`mockwa:idem:${idempotencyKey}`);
  if (existing) {
    res.json({ messageId: existing, duplicate: true });
    return;
  }

  const roll = Math.random();
  if (roll < failureRate) {
    res.status(500).json({ error: 'Internal error (simulated)' });
    return;
  }
  if (roll < failureRate + timeoutRate) {
    await sleep(HANG_MS);
    res.status(504).json({ error: 'Gateway timeout (simulated)' });
    return;
  }

  const messageId = `wamid.${randomUUID()}`;
  // SET NX: two identical requests at the same moment still deliver once.
  const stored = await redis.set(`mockwa:idem:${idempotencyKey}`, messageId, 'NX');
  if (stored) {
    await redis.lpush(
      `mockwa:inbox:${to}`,
      JSON.stringify({ messageId, to, caption, document, receivedAt: new Date().toISOString() }),
    );
    await redis.incr('mockwa:delivered');
  }
  const finalId = stored ? messageId : (await redis.get(`mockwa:idem:${idempotencyKey}`))!;

  if (roll < failureRate + timeoutRate + lostResponseRate) {
    await sleep(HANG_MS); // delivered, but the caller never hears back
  }
  res.json({ messageId: finalId });
});

app.get('/v1/inbox/:phone', async (req, res) => {
  const messages = await redis.lrange(`mockwa:inbox:${req.params.phone}`, 0, -1);
  res.json(messages.map((message) => JSON.parse(message)));
});

app.get('/v1/stats', async (_req, res) => {
  res.json({ delivered: Number((await redis.get('mockwa:delivered')) || 0), outage: (await redis.get('mockwa:outage')) === '1' });
});

app.post('/admin/outage', async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  await redis.set('mockwa:outage', enabled ? '1' : '0');
  res.json({ outage: enabled });
});

app.listen(port, () => console.log(`Mock WhatsApp listening on ${port}`));
