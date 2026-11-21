# Local setup

From a fresh clone to a running system with demo data and passing tests.

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose v2), running.
- Free ports: `8080` (web), `3000` (API), `4001` (mock WhatsApp), `5432` (Postgres), `6379` (Redis).
- Node.js 22+ only if you want to run things outside Docker.

## 1. Start everything (one command)

```bash
git clone <repo-url> certiflow
cd certiflow
docker compose up --build
```

What happens:
1. `postgres` and `redis` start (healthchecks).
2. `migrate` applies Prisma migrations and seeds the demo users + one batch waiting for district review, then exits.
3. `api`, `worker`, `mock-whatsapp` and `web` start.

Open **http://localhost:8080**.

## 2. Try the flows

For a complete step-by-step script with the expected result of every case, see [TESTING.md](TESTING.md).

Pick a person in the top-right "Acting as" menu.

| Flow | Steps |
|---|---|
| Bad spreadsheet (moment 1) | **Anika** → *Create batch* → upload `samples/batch-with-errors.csv` → every bad row is listed, nothing saved. |
| Happy path | **Anika** → upload `samples/batch-small-valid.csv` → *Submit*. **Dev** → open it → *Approve*. **Meera** → *Approve* (quorum reached). **Farah** → *Approve*. Within seconds certificates appear and turn **SENT**, even though the mock WhatsApp fails ~40% of calls. |
| Quality review | Same with `samples/batch-60-quality-review.csv` → after the district it goes to **Neha**. |
| Candidate phone | *Candidate phone* tab → enter a phone (e.g. `+919700000100`) → exactly one message with the PDF link. |
| Verify / cancel (moment 4) | *Verify a certificate* → paste a number → **Genuine**. **Farah** → *Certificates* → *Cancel*. Verify again → **no longer valid**. |
| Send back (moment 6) | **Dev** approves, **Kabir** *Send back* with a reason. **Anika** re-uploads and *Resubmit* → revision 2; Dev's earlier approval no longer counts. |
| Stuck batch (moment 5) | Leave a batch in review for 5 minutes (`SLA_MINUTES=5` in docker-compose). It shows *Escalated* and appears under **Farah**'s *Stuck batches*. |
| Live updates | Open two browser windows as different people; actions in one appear in the other without refresh. |
| WhatsApp outage | `curl -X POST localhost:4001/admin/outage -H 'Content-Type: application/json' -d '{"enabled":true}'` → approve a batch → deliveries retry with backoff; switch it off and they go through. |

## 3. Run the tests

```bash
docker compose --profile test run --rm --build test
```

Runs migrations on a separate `certiflow_test` database and all Jest suites (unit + integration). Expected: `Tests: 136 passed`.

## 4. Developing without Docker for the app (optional)

```bash
docker compose up -d postgres redis          # only the infrastructure
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy && npx prisma db seed
npm run dev:mock-whatsapp                     # terminal 1
npm run dev:api                               # terminal 2
npm run dev:worker                            # terminal 3
npm test                                      # uses certiflow_test (see test/setup-env.ts)

cd ../frontend && npm install && npm run dev  # http://localhost:5173
```

## 5. Useful commands

```bash
docker compose up --scale worker=3                 # several workers; correctness holds
docker compose logs -f worker                      # JSON logs, grep a correlationId to trace a batch
docker compose restart worker                      # restart mid-delivery: jobs resume, no duplicates
docker compose down -v                             # stop and delete all data
```

## Troubleshooting

- **Port already in use:** stop the other service or change the left side of `ports:` in `docker-compose.yml`.
- **`certiflow_test` does not exist:** the init script only runs on a new Postgres volume — run `docker compose down -v` once.
