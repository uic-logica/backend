# QA environment

A throwaway copy of the platform with **filler accounts and filler data only**. No
real member, speaker or budget data is in it, so the credentials below can be
shared with everyone who is testing.

## What the filler data covers

`prisma/seed-qa.ts` creates, all on `@qa.logica.test`:

- **3 exec (EXEC_BOARD)**, **3 board (BOARD)**, **4 member (MEMBER)** accounts — several of
  each so two testers can hold the same role at once.
- **4 guest (SPEAKER) accounts**, one per stage: unconfirmed candidate, candidate ready to
  decide on, confirmed speaker with a scheduled talk, declined guest.
- 5 events (past, imminent, far out), RSVPs, attendance rows and an open check-in code.
- A budget with money items in every stage, outreach items in every stage.
- Membership applications in every status, feed posts, notifications, a form and a
  submission, mailing-list subscribers, and a board↔guest message thread.

## Credentials

| Role | Sign in at | Username / email |
| --- | --- | --- |
| Exec | member sign-in | `exec1@qa.logica.test`, `exec2@…`, `exec3@…` |
| Board | member sign-in | `board1@qa.logica.test`, `board2@…`, `board3@…` |
| Member | member sign-in | `member1@qa.logica.test` … `member4@…` |
| Guest | speaker sign-in | `qa-guest-candidate`, `qa-guest-ready`, `qa-guest-speaker`, `qa-guest-declined` |

Password for every one of them: `logica-qa-2026`

## Standing up the environment

1. **Database.** Create an empty Postgres for QA (its own database, not a schema inside
   production). Anything reachable from the deployment works.
2. **Backend project env** (QA target only):
   - `DATABASE_URL` → the QA database
   - `ALLOWED_EMAIL_DOMAIN` → `qa.logica.test` — this is what keeps the filler accounts
     from being usable anywhere else
   - `FRONTEND_URL` → the QA frontend origin, no trailing slash
   - `AUTH_SECRET` → a fresh value, not production's
3. **Frontend project env:** `NEXT_PUBLIC_API_URL` → the QA backend origin.
4. **Migrate and seed:**
   ```bash
   DATABASE_URL=<qa> npx prisma migrate deploy
   npm run db:seed:qa        # reads .env.qa
   ```
   The seed prints the accounts and the check-in code when it finishes.

## Safety

`seed-qa.ts` counts accounts whose email is outside `@qa.logica.test` and **refuses to run**
if it finds any, so pointing it at production stops instead of seeding it. `QA_SEED_FORCE=1`
overrides that check — there is no reason to use it.

Re-running the seed is safe: every row upserts on a stable `qa-` id, so it repairs the data
instead of duplicating it. To reset completely, drop and recreate the QA database, migrate,
seed again.

## Local

```bash
node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/logica_qa";console.log(u.toString())' --env-file=.env
# put that in .env.qa as DATABASE_URL, with ALLOWED_EMAIL_DOMAIN="qa.logica.test"
DATABASE_URL=<that> npx prisma migrate deploy
npm run db:seed:qa
```

`.env.qa` is git-ignored like every other env file.
