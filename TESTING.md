# Testing guide for reviewers

A step-by-step script to check every requirement from the problem statement yourself, from a fresh clone.
Every test case lists **what to do** and **what you should see**. It takes about 25 minutes by hand; the automated suite takes about 1 minute.

- How the system works and why: [README.md](README.md)
- Setup details and troubleshooting: [SETUP.md](SETUP.md)

---

## 0. Start the system

**You need:** Docker Desktop (running) and Git. Nothing else: no Node.js, PostgreSQL or Redis install.
**Free ports:** 8080, 3000, 4001, 5432, 6379.

```bash
git clone <repo-url> certiflow
cd certiflow
docker compose up --build
```

The first start takes a few minutes (it downloads images and builds). It's ready when `api` reports healthy and the logs calm down.

| Open | What it is |
|---|---|
| http://localhost:8080 | The web app |
| http://localhost:3000/health | API health check (should answer OK) |

**Demo people** (top-right **"Acting as"** menu, no password):

| Person | Role |
|---|---|
| Anika | Training centre (Anika Skills Academy, Pune) |
| Dev, Meera, Kabir | District officers (Pune) |
| Neha | Quality team |
| Farah | State office |
| *nobody (public)* | An employer / member of the public |

The seed also creates one batch already waiting for district review, so officers have something to look at immediately.

**Spreadsheets to upload** are in [`samples/`](samples):

| File | Content | Expected upload result |
|---|---|---|
| `batch-small-valid.csv` | 8 valid candidates | Accepted |
| `batch-with-errors.csv` | 5 rows, 4 bad (incl. an Excel formula injection) | Rejected, 4 errors |
| `batch-mixed-good-and-bad-rows.csv` | 11 rows: 3 good, 8 bad (one of each kind of error) | Rejected, 8 errors, nothing saved |
| `batch-mixed-fixed.csv` | The same 11 people, corrected | Accepted, 11 candidates |
| `batch-missing-phone-column.csv` | Header has no `phone` column | Rejected: `Missing column "phone"` |
| `batch-60-quality-review.csv` | 60 valid candidates | Accepted; needs the quality team |

> A person can be certified only once per course. If you reuse a file for a second batch, use a **different course code**, or the upload is refused (that's the rule working, see TC-14).

---

## 1. Automated tests (fastest proof)

```bash
docker compose --profile test run --rm --build test
```

**Expected:** `Test Suites: 8 passed` and `Tests: 136 passed`.
They run against a separate `certiflow_test` database, so your demo data is untouched.

| File | Proves |
|---|---|
| `backend/test/moments.spec.ts` | The 6 "moments that must work" |
| `backend/test/never-happen.spec.ts` | The "things that must never happen" |
| `backend/test/auth.spec.ts` | Demo login only exists when `DEMO_LOGIN_ENABLED=true` |
| `backend/src/**/*.spec.ts` | Unit tests: workflow rules, spreadsheet parser, download tokens, certificate numbers, masking |

---

## 2. Manual test cases: the moments that must work

### TC-01: Spreadsheet with bad rows (moment 1)
1. **Anika** → *New batch* → course `ELEC-101` / `Assistant Electrician` → *Create batch*.
2. Upload `samples/batch-mixed-good-and-bad-rows.csv`.

**Expected:** an error list with row, column and problem:

| Row | Column | Problem |
|---|---|---|
| 3 | phone | Not a valid 10-digit Indian mobile |
| 5 | enrolment_id | Duplicate of row 2 |
| 6 | score | Below the pass mark (40) |
| 7 | name | Only letters allowed (`R2D2`) |
| 8 | phone | Duplicate of row 2 |
| 9 | score | Must be 0–100 (`105`) |
| 11 | score | Must be 0–100 (`abc`) |
| 12 | enrolment_id | Invalid characters (`TST#011`) |

The batch still has **0 candidates**: the 3 good rows were **not** saved either (all-or-nothing).

3. Upload `samples/batch-missing-phone-column.csv` → **Expected:** `Missing column "phone"`.
4. Upload `samples/batch-mixed-fixed.csv` → **Expected:** 11 candidates listed.

### TC-02: Two district officers approve together (moment 2)
1. Still as **Anika**, on the TC-01 batch → *Submit for approval* → status **District review**.
2. Open the batch as **Dev** and, in a second browser window (or incognito), as **Meera**.
3. Click **Approve** in both windows as close together as you can.

**Expected:** the batch moves to **State review** exactly once. The History box shows two approvals and one stage change. A third officer (**Kabir**) now sees that the batch has already moved on (HTTP 409 via the API), and the approve buttons are gone.

> Clicking by hand can't be truly simultaneous. The automated test fires the approvals in parallel: `moments.spec.ts` → "Moment 2". Quick API version:
> ```bash
> # bash / Git Bash; replace <BATCH_ID> (from the browser URL)
> T(){ curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$1\"}" | sed 's/.*"token":"\([^"]*\)".*/\1/'; }
> for u in dev meera kabir; do curl -s -X POST localhost:3000/api/batches/<BATCH_ID>/reviews -H "Authorization: Bearer $(T $u)" -H 'Content-Type: application/json' -d '{"decision":"APPROVE","revision":1}' & done; wait
> ```
> Expected: two succeed (count 1/2, then 2/2) and one gets `409 ... already moved past your review stage`.

### TC-03: Final approval → certificates on WhatsApp, despite failures (moment 3)
1. **Farah** → open the batch → **Approve**.

**Expected, within a few seconds and without refreshing:**
- A **Certificates** table appears: 11 rows, each with a unique number like `PSM-2026-XXXXXXXX`.
- WhatsApp status goes **PENDING → SENT**. Some rows show **Attempts 2 or 3**: the mock provider fails, times out or loses responses on purpose (`MOCK_FAILURE_RATE`, etc. in `docker-compose.yml`), and the worker retries.
2. Open **Candidate phone** (top menu) → enter `+919811100001` → *Open inbox*.

**Expected:** **exactly 1** message, with a 📄 PDF link. Open it → certificate PDF with a QR code. Check other numbers (`+919811100002` … `+919811100011`): each has exactly one message, including those that needed retries.

### TC-04: Large batch needs the quality team
1. **Anika** → new batch with course code `WELD-301` → upload `samples/batch-60-quality-review.csv` → Submit.
2. **Dev** + **Meera** approve.

**Expected:** status becomes **Quality review** (not State review), because the batch has more than 50 candidates. **Neha** sees it under "Waiting for you" and approves → then **Farah** → 60 certificates, 60 phones with 1 message each.

### TC-05: Cancel a fake certificate (moment 4)
1. Log out (Acting as → *nobody (public)*) → **Verify a certificate** → paste a number from TC-03 → *Check*.
   **Expected:** ✔ **Genuine certificate**, with a masked name (e.g. `Pr*** Pa***`), course, centre and date. **No phone number.**
2. **Farah** → *Certificates* → find it → **Cancel** → enter a reason.
3. Verify the same number again.
   **Expected:** ✖ **This certificate is no longer valid**, immediately (the Redis cache entry is cleared on cancel).
4. Open that candidate's PDF link from the phone inbox → **Expected:** refused (HTTP 410), because cancelled certificates can't be downloaded.
5. Verify a made-up number, e.g. `PSM-2026-NOTREAL1` → **Expected:** "No certificate with this number exists".

### TC-06: Batch stuck with an officer (moment 5)
1. **Anika** → new batch (course code `PLMB-201`) → upload `samples/batch-small-valid.csv` → Submit. **Don't approve it.**
2. Wait **6 minutes** (the demo sets `SLA_MINUTES=5`; production default is 48 hours).

**Expected:** the batch gets a red **Escalated** badge. **Farah**'s home page shows **"Stuck batches (1)"** with how long it has waited. The History box has a "batch escalated" entry by the system. Nobody had to chase it.
It escalates **once** per stage, not every minute.

### TC-07: Send back, fix and resend (moment 6)
1. Use a batch in district review (the seeded one works). **Dev** → **Approve** (1/2).
2. **Kabir** → type a reason (e.g. "Fix row 3 phone") → **Send back**.
   **Expected:** status **Sent back**; **Anika** sees the reason.
3. **Anika** → (optionally re-upload) → **Resubmit for approval**.
   **Expected:** **revision 2**; approvals show **0 / 2**. Dev's earlier approval **no longer counts**; it belonged to revision 1 and stays in the History box.
4. Why: the candidate list may have changed, so approving data an officer never saw would make the record false. See README → "Decisions where the brief was unclear".

### TC-08: Live updates without refresh
Open two browser windows: **Anika** on her batch, **Dev** on the same batch. Dev approves.
**Expected:** Anika's window updates by itself (status and history), and a "● live" indicator shows the last event.

---

## 3. Manual test cases: things that must never happen

### TC-09: Acting at a step that isn't yours
| Try | Expected |
|---|---|
| **Anika** opens a batch in district review | No approve/reject buttons |
| **Neha** opens a batch in *district* review | No buttons (not her stage) |
| **Dev** approves the same batch twice | Second attempt refused: one officer counts once |
| **Meera** tries to cancel a certificate (API) | `403 You do not have access to this action` |

Via the API (proves the **server** enforces it, not just the hidden buttons):
```bash
curl -s -X POST localhost:3000/api/batches/<BATCH_ID>/reviews -H "Authorization: Bearer $(T anika)" -H 'Content-Type: application/json' -d '{"decision":"APPROVE","revision":1}'
# → 403
```

### TC-10: Acting as someone else
```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/batches -H "Authorization: Bearer $(T dev)x"   # edited token → 401
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/batches                                     # no token     → 401
```
Sending `"reviewerId": <someone else>` in a review body is ignored; the reviewer always comes from the signed token (automated test "ignores a reviewer id smuggled into the request body").

### TC-11: A stranger getting someone else's certificate
Take a PDF link from the phone inbox: `.../api/public/certificates/<NUMBER>/pdf?token=<TOKEN>`.

| Change | Expected |
|---|---|
| Remove `?token=...` | 403 |
| Keep the token, change `<NUMBER>` to another certificate | 403 (the token is signed for one certificate) |
| Change any digit of the token | 403 (signature check fails) |

### TC-12: Personal details exposed
- The public verify page shows a **masked** name and **never** the phone number.
- An officer of another district can't see Pune's batches (automated test "hides a batch from an officer of another district").
- Phone numbers and names are not written to the logs (the logger redacts `phone`, `name` and `candidateName` fields): `docker compose logs worker | grep 98111` → no matches.

### TC-13: Untraceable decision
Open any batch → **History (who did what, when)**: every upload, submit, approve, send back, reject, escalation and certificate event, with the person and time.
In the database: table `audit_logs` (see section 5).

### TC-14: Two certificates for one candidate, or a shared number
- Upload `samples/batch-mixed-fixed.csv` again in a **new** batch with the **same course** `ELEC-101` after TC-03.
  **Expected:** refused with one error per row, because these candidates already hold a certificate for that course.
  The same happens if they're still in another *submitted* batch of the course: `Already in batch B-... (DISTRICT_REVIEW) for this course`.
- Database guarantees: `certificates.candidate_id` and `certificates.certificate_no` are **unique**, so even buggy code can't create a duplicate (automated tests "refuses a second certificate for the same candidate at the database level" and "refuses a certificate number that is already used").

---

## 4. Resilience checks (optional, about 5 min)

| Scenario | How | Expected |
|---|---|---|
| **WhatsApp outage** | `curl -X POST localhost:4001/admin/outage -H 'Content-Type: application/json' -d '{"enabled":true}'` → approve a batch as Farah | Certificates are issued, but delivery stays **PENDING** with increasing attempts. Turn it off (`"enabled":false`) → they go **SENT**, still 1 message per phone. |
| **Worker crash mid-delivery** | Approve a batch, then immediately `docker compose restart worker` | Deliveries resume after restart; no duplicates in the phone inbox. |
| **More workers** | `docker compose up -d --scale worker=3` and approve the 60 batch | Same result: 60 certificates, 1 message each. |
| **Provider stats** | `curl localhost:4001/v1/stats` | Count of delivered messages |

---

## 5. Look inside the database (optional)

**Option A: Prisma Studio (browser, nothing to install besides Node.js 22+)**
```bash
cd backend
cp .env.example .env     # Prisma reads the database address from here
npm install
npx prisma studio        # opens http://localhost:5555
```

**Option B: SQL inside the Postgres container (no install)**
```bash
docker compose exec postgres psql -U certiflow -d certiflow
```
```sql
\dt
SELECT code, status, revision, escalated_at FROM batches ORDER BY created_at DESC;
SELECT batch_id, revision, stage, decision, reviewer_id, created_at FROM batch_reviews ORDER BY created_at DESC;
SELECT certificate_no, status, delivery_status, delivery_attempts FROM certificates ORDER BY issued_at DESC;
SELECT action, actor_role, entity_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20;
\q
```

**Option C: a desktop client** (DBeaver, pgAdmin): host `localhost`, port `5432`, database, user and password all `certiflow`.

| Table | What to look for |
|---|---|
| `batches` | `status`, `revision` (moment 6), `escalated_at` (moment 5) |
| `candidates` | No rows for a batch after a failed upload (moment 1) |
| `batch_reviews` | One row per officer per stage per revision (moment 2) |
| `certificates` | One per candidate, `delivery_attempts` > 1 where WhatsApp failed (moment 3), `status = REVOKED` (moment 4) |
| `audit_logs` | Who did what, when |
| `outbox_events` | Every event; `published_at` set once handed to the queue |

---

## 6. Trace one batch end to end (observability)

Every request gets a **correlation ID**, which is also returned in error responses. It's carried into the queue jobs, so one ID connects the API call, the certificate issuing and every WhatsApp attempt:

```bash
docker compose logs api worker | grep <correlationId>
```

---

## 7. Reset

```bash
docker compose down -v     # stop and delete all data
docker compose up --build  # fresh start with demo data
```

---

## Results checklist

| ID | Requirement | Pass? |
|---|---|---|
| Auto | 136 automated tests | ☐ |
| TC-01 | Bad rows listed, nothing saved | ☐ |
| TC-02 | Simultaneous approvals → one stage change | ☐ |
| TC-03 | Exactly one certificate + one message each, despite failures | ☐ |
| TC-04 | Large batch → quality team | ☐ |
| TC-05 | Cancelled → "no longer valid" immediately | ☐ |
| TC-06 | Stuck batch escalated automatically | ☐ |
| TC-07 | Send back → new revision, old approvals don't count | ☐ |
| TC-08 | Live updates without refresh | ☐ |
| TC-09/10 | No acting at another step or as another person | ☐ |
| TC-11/12 | No access to others' certificates or personal data | ☐ |
| TC-13 | Every decision traceable | ☐ |
| TC-14 | No duplicate certificates or numbers | ☐ |
