# CertiFlow — Skilling Certificate Issuance Platform

Training centres upload passed batches → district officers, the quality team and the state office approve → every candidate gets a certificate PDF on WhatsApp → anyone can check a certificate is genuine.

- **Run it:** `docker compose up --build` → open http://localhost:8080 (full guide: [SETUP.md](SETUP.md))
- **Tests:** `docker compose --profile test run --rm test`
- **Production plan:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 1. Requirements note

The brief was short. This is how I turned it into requirements, and the decisions I made where it was unclear.

### Who does what

| Person (demo user) | Can do |
|---|---|
| Training centre (**Anika**) | Create a batch, upload the spreadsheet (.csv/.xlsx), submit, track status, fix and resubmit when sent back. Sees only its own batches. |
| District officer (**Dev, Meera, Kabir** — Pune) | See what is waiting for them, review, approve / send back / reject with a reason. Only batches of centres in their district. |
| Quality team (**Neha**) | Reviews large batches after the district. |
| State office (**Farah**) | Final approval, sees stuck batches, cancels certificates. |
| Candidate | Receives the certificate on WhatsApp with a download link. |
| Public / employer | Checks a certificate by number or QR code, no login. |

### Workflow

```
DRAFT ──submit──▶ DISTRICT_REVIEW ──2 officers approve──▶ QUALITY_REVIEW (only if > 50 candidates) ──▶ STATE_REVIEW ──▶ APPROVED
  ▲                    │ any stage: 1 reviewer sends back                                                               │
  └── SENT_BACK ◀──────┤                                                                          batch.approved event ▼
      (fix, resubmit → revision + 1)                                          issue certificates → PDF → WhatsApp (retries)
                       └── reject (district: 2 officers agree; quality/state: 1) ──▶ REJECTED
Certificate: ISSUED ──state office cancels──▶ REVOKED (verification says "no longer valid" immediately)
```

### Decisions where the brief was unclear

| Question | Decision | Why |
|---|---|---|
| "A district decision needs more than one officer to agree" — how many? | **2 distinct officers** of that district (configurable: `DISTRICT_APPROVALS_REQUIRED`). Applies to *approve* and to *reject*. | Two is the smallest number that is "more than one"; a district has 3 officers, so one being on leave does not block it. |
| Does a single officer's "send back" need a quorum too? | **No**, one reviewer can send back. | Send back ends nothing; the centre just fixes. Waiting for a 2nd officer would leave a known-bad batch in limbo. |
| What is a "big batch"? | **More than 50 candidates** (`QUALITY_REVIEW_THRESHOLD`). | The brief's example batch is 60; typical batches are ~25–30. |
| **Moment 6:** what happens to approvals after send back + resubmit? | Resubmitting creates **revision + 1**. Reviews belong to a revision, so earlier approvals **no longer count**; the whole chain starts again. Old reviews stay for the audit trail. An officer approving the old revision gets 409. | The candidate list may have changed. Counting an approval for data the officer never saw would make the record a lie. |
| Who is a "passed" candidate? | Score **≥ 40**. Rows below are rejected at upload. | The brief says centres upload *passed* candidates. |
| Can a candidate be certified twice? | Not for the same course while a valid certificate exists (checked at upload); one certificate per candidate row (database unique key). | "A candidate getting two certificates" must never happen. |
| How long is "too long" with an officer? | `SLA_MINUTES` (default 48 h in production, **5 min in the demo**). The batch is marked *Escalated* and shows on the state office's "Stuck batches" list. | Someone senior finds out without chasing. |
| What can the public see? | Valid / revoked / not found, masked name ("Ra** Ku***"), course, centre, issue date. **Never the phone number.** | Enough for an employer to compare with the paper, useless for scraping personal data. |
| Who can download a PDF? | Whoever has the **signed link** from the WhatsApp message (HMAC token, 30-day expiry). | No login for candidates, but a stranger cannot guess a link. |
| Login | Demo login by picking a person (as the brief asks). Production: SSO/OTP in front of the same JWT + role checks. | Reviewers must switch between people instantly. |

### The moments that must work → where they are handled

| Moment | How | Proven by |
|---|---|---|
| 1. Bad rows in the spreadsheet | Every row validated first, **all** errors returned (row, column, message); nothing written unless the file is clean; the replace runs in **one transaction**. | `test/moments.spec.ts` "Moment 1" |
| 2. Two officers approve at once | `SELECT … FOR UPDATE` on the batch row inside the transaction + status check + unique key `(batch, revision, stage, reviewer)`. | "Moment 2" (3 concurrent approvals → one stage change, one 409) |
| 3. 60 candidates, unreliable WhatsApp | Unique `candidate_id` on certificates; issuing is idempotent; delivery job per certificate with **idempotency key** (certificate id), exponential retries, dead-letter → `FAILED`. | "Moment 3" (fails + lost responses + duplicate jobs → 60 certificates, 60 phones × 1 message) |
| 4. Cancel → employer sees invalid | Revoke in a transaction, then delete the Redis cache entry; cache TTL 30 s as a fallback. | "Moment 4" |
| 5. Batch stuck with an officer | Worker scans every minute; conditional update `escalated_at IS NULL` so it fires once even with many workers. | "Moment 5" |
| 6. Send back and resend | Revision bump (see decisions). | "Moment 6" |

"Must never happen" rules are each covered in `test/never-happen.spec.ts`.

---

## 2. How the system is put together

```
 Browser (React) ──HTTP/SSE──▶ nginx ──▶ API (Express) ───────────────┐
                                           │ commands / queries       │ subscribe
                                           ▼                          │
                                   PostgreSQL ◀── outbox_events       Redis ◀── publish
                                       ▲               │ (same tx)     ▲  ▲
                                       │               ▼               │  │ cache / rate limit / queues
                                   Worker ── OutboxRelay ─▶ BullMQ queues ─┘
                                       │  domain-events: batch.approved → issue certificates
                                       │  certificate-delivery: PDF + WhatsApp (retries)
                                       │  maintenance: SLA scan every minute
                                       ▼
                                 Mock WhatsApp (fails, times out, loses responses)
```

| Container | Role |
|---|---|
| `api` | Express REST API + Server-Sent Events. Stateless; scale horizontally. |
| `worker` | Outbox relay + queue consumers. Scale with `docker compose up --scale worker=3`. |
| `postgres` | Source of truth: batches, candidates, reviews, certificates, audit log, outbox. |
| `redis` | BullMQ queues, verification cache, rate limiting, realtime pub/sub. |
| `mock-whatsapp` | Stand-in provider with configurable failure / timeout / lost-response rates and an outage switch. |
| `web` | nginx serving the React app and proxying `/api`. |
| `migrate` | Runs Prisma migrations + idempotent demo seed, then exits. |

### Code layout (CQRS, same structure as our NestJS services, in plain Express)

```
backend/src/
  core/cqrs/            CommandBus, QueryBus, EventBus, @CommandHandler/@QueryHandler/@EventsHandler
  database/             DataSource (transaction wrapper) + one *DatabaseService per table
  batch/
    commands/impl       CreateBatch, UploadCandidates, SubmitBatch, ReviewBatch, EscalateStuckBatches
    commands/handlers   the write logic — each one: validate → dataSource.transaction(manager => …)
    queries/impl|handlers  FetchBatches, FetchOneBatch, FetchPendingReviews, FetchBatchTimeline, FetchStuckBatches
    events/impl         batch.* event types
    services/           BatchWorkflowService (pure rules), CandidateSheetParserService
    batch.controller.ts Express router: validate input → commandBus/queryBus
    batch.module.ts     wires handlers with their dependencies
  certificate/          same shape: Issue/Deliver/Revoke commands, Verify/Download queries, event handlers
  worker.ts             queue consumers + outbox relay + SLA schedule
  mock-whatsapp/        the stand-in provider
```

Every write follows the same pattern, so it is easy to review:

```ts
await this.dataSource.transaction(async (manager) => {
  const batch = await this.batchDatabaseService.lockBatchForUpdate(batchId, manager); // row lock
  // ...checks: status, revision, role, district...
  await this.batchReviewDatabaseService.createReview({...}, manager);             // the change
  await this.auditLogDatabaseService.record({...}, manager);                       // who / when
  await this.eventBus.publish(manager, BatchApprovedEvent, batchId, payload);     // outbox row
}); // any throw above → everything rolls back, including the event
```

---

## 3. Key technical decisions

| Decision | Why |
|---|---|
| **Transactional outbox** instead of publishing to the queue from the request | The state change and the event commit together. No "approved but certificates never issued", no "event for a change that rolled back". The relay uses `FOR UPDATE SKIP LOCKED` so several workers can relay safely. |
| **BullMQ on Redis** as the queue | Redis is already required; BullMQ gives retries with backoff, delayed jobs, job de-duplication by `jobId`, repeatable schedules (SLA scan) and survives worker restarts. Kafka/RabbitMQ would add another system for no gain at this scale. |
| **Idempotency everywhere it matters** | Queues deliver at least once. Each consumer is safe to repeat: unique keys in Postgres, `jobId` = event id / certificate id, WhatsApp idempotency key = certificate id, conditional updates (`WHERE status = 'ISSUED'`, `WHERE escalated_at IS NULL`). |
| **Pessimistic row lock** for reviews | Simple to reason about and correct: concurrent reviews of one batch are serialised; different batches never wait for each other. |
| **Revision number** on batches | Makes moment 6 explicit and stops an officer approving a version they did not see (request carries the revision it was looking at). |
| **Redis cache for verification, Postgres as truth** | Bursts of public lookups hit Redis; revoke deletes the key; 30 s TTL bounds staleness if Redis misses the delete; Redis down → falls back to Postgres. |
| **Random certificate numbers** (`PSM-2026-7KQ2MX9P`) | Cannot be enumerated; unique index guarantees no clash; no ambiguous characters. |
| **Server-Sent Events** for live updates | One-way server → browser is all we need; works through nginx; Redis pub/sub fans out across API instances. |
| **Prisma** with migrations | Required by the brief; wrapped in a `DataSource` so the code reads like our TypeORM services. |
| **Correlation id** on every request, audit row, outbox event and job | One id traces a batch from the HTTP request through the worker to the WhatsApp call (`x-correlation-id` header, JSON logs, `audit_logs.correlation_id`). |

### Security

- Identity only from the signed JWT (HS256 pinned); the user is re-loaded from the database on each request. A `reviewerId` in the body is ignored (tested).
- Role checks on routes **and** fine-grained checks in handlers (own centre, own district, current stage).
- Batches outside your scope return 404 (no existence leak).
- Input validated with zod; uploads in memory, 2 MB limit, .csv/.xlsx only, formula-looking names rejected.
- Public endpoints rate-limited per IP (Redis); `helmet` headers; personal data redacted from logs.

### Observability

- Batch page shows a full **history** (audit log): who did what, when, with reasons.
- JSON logs (pino) with `correlationId` on every line, across API and worker.
- Certificate rows keep `delivery_attempts`, `last_delivery_error`, `provider_message_id`.

---

## 4. Tests

```bash
docker compose --profile test run --rm test      # everything, in containers
# or locally: cd backend && npm test              (needs postgres + redis from docker compose)
```

- **Unit:** workflow rules, spreadsheet validation, download tokens, masking, certificate numbers.
- **Integration** (real Postgres + Redis): all six moments and every "must never happen" rule.
- 127 tests, all passing.

---

## 5. AI usage

I used Claude Code (AI assistant) to scaffold the project, write the first version of the handlers, tests and docs, and to mirror the CQRS structure of my company's NestJS services in Express.

How I checked it:
- Read every file, kept the structure I already know (commands/queries/handlers, `DataSource.transaction`, `*DatabaseService`).
- Ran the system end to end (concurrent approvals with curl, flaky WhatsApp, revoke + verify) and checked the database.
- The integration tests caught two real bugs in the AI-written code, which were fixed: a CSV cell with a stray quote crashed the upload with a 500, and a late third officer got a misleading 403 instead of 409.

---

## 6. Known limitations and next steps

- **WhatsApp idempotency:** the stand-in honours an `Idempotency-Key`. The real Meta Cloud API does not; in production we would use a BSP that supports it, or accept a very rare duplicate when a response is lost (we already never *issue* twice).
- **Demo login** has no password; production needs SSO/OTP.
- PDFs are stored on a shared Docker volume; production uses object storage (see DEPLOYMENT.md).
- SSE token is passed in the query string (EventSource cannot send headers); production would use a short-lived cookie.
- No UI to retry a `FAILED` delivery yet (the job can be re-queued from the queue); no pagination on long lists (capped at 200).
- No per-district SLA or reminder before escalation; no email/SMS fallback channel.
- Frontend has no automated tests; backend coverage focuses on the brief's moments and rules.
