# LOGICA @ UIC — backend

Next.js 16 App Router API for the LOGICA frontend. Prisma 7 and Postgres hold accounts, sessions, events, participation, guest visits, and the exec workspace. Dependencies and commands live in `package.json`; the data model is `prisma/schema.prisma`.

## Local setup

1. `npm ci`.
2. Copy `.env.example` to `.env`. Prisma CLI and the admin script load it through `dotenv/config`; Next.js also reads it. Set `DATABASE_URL`, `AUTH_SECRET`, `ALLOWED_EMAIL_DOMAIN`, and `FRONTEND_URL`.
3. Run `npx prisma generate`, then `npx prisma migrate deploy` against your development database to apply the checked-in migrations.
4. `npm run dev` starts the API on port 3001. The frontend proxies `/api/*` from port 3000.

SMTP is for notifications and the older emailed guest invitation, not member sign-in. Its settings are in `.env.example`. Read [AUTH.md](AUTH.md) before provisioning accounts.

## Where things are

- `auth.ts`, `app/api/auth/`, `lib/session.ts` — password login with Auth.js database sessions. Members use email and an issued password; guests use username or email and password. No public member signup. The old OTP endpoint returns 410.
- `scripts/issue-member-password.ts`, `lib/member-password.ts`, `app/api/board/members/password/route.ts` — member credential issuance and recovery. The script preserves roles; it does not bootstrap an exec role.
- `lib/authz.ts`, `lib/board-guard.ts` — workspace access is **MEMBER account + EXEC_BOARD role**. BOARD gets the member workspace view. Do not infer permissions from comments saying “board+”; read the handler's actual guard.
- `app/api/board/` — budgets, money/outreach items, member roster and role/officer edits, insights, and Drive documents. Every route starts with the shared guard, including credential issuance after its request-origin check.
- `lib/board-item.ts` — MONEY and OUTREACH are two kinds of one `BoardItem` table. Amounts are whole cents; stages are validated strings. Budget balances are computed from non-archived items. DELETE archives an item; PATCH can restore it. Stage changes record who moved it and when.
- `lib/insights.ts` — member counts, 90-day check-in activity, latest 20 events with RSVP/attendance counts, top attendees, and guest/application status totals.
- `app/api/speakers/`, `lib/invite.ts`, `app/api/invites/` — public intake, exec review, single-use account invitations, and the older draft-completion and emailed-account paths. `VisitKind` is TALK, WORKSHOP, or COMPANY_VISIT. A submission can link to one scheduled Event.
- `app/api/speaker-profile/route.ts` — guests edit availability; confirmed guests can edit talk title and slides URL. Linked events supply RSVP/check-in/feed counts.
- `app/api/events/` — public event list/detail, RSVP, event feed, materials, and check-in administration. `app/api/attendance/checkin/route.ts` requires both event ID and code.
- `app/api/dashboard/route.ts` — the session user's engagement counts, RSVPs, and latest 20 attendance/post/form records per category.
- `app/api/join/route.ts` — public membership applications, separate from account creation. The paired frontend's `/join` currently uses email instead of this API.
- `lib/prisma.ts` — shared database client. Reuse it.

## MCP

`lib/mcp-tools.ts` registers **23 tools**. `toolsFor()` filters by the caller's stage; `app/api/mcp/route.ts` checks the stage again on every tool call. `lib/mcp-token.ts` derives it from the live user and guest submission, so changing a role changes token access.

BOARD has the same toolset as MEMBER. Workspace tools are exec-only. No registered tool issues or resets passwords. Keep credential issuance outside MCP. Stage filtering is covered by `lib/stage.test.ts`; this checkout has no dedicated password-tool exclusion test.

## Vercel and Supabase configuration

Use `npm run build`: `package.json` runs `prisma generate && next build`. It does **not** apply migrations. For the Supabase deployment, apply `prisma/migrations/` manually through the session pooler by overriding `DATABASE_URL` for `npx prisma migrate deploy`. Keep the runtime connection separate from that command's override.

`prisma.config.ts` reads only `DATABASE_URL`. Do not add `directUrl`: the installed `@prisma/config` Datasource type supports `url` and `shadowDatabaseUrl`, not that key. Set the backend's `FRONTEND_URL` to the frontend's exact origin. Set the frontend's `NEXT_PUBLIC_API_URL` to the backend origin.

`vercel.json` schedules `/api/cron/event-reminders` at `0 13 * * *`. The handler reminds GOING RSVPs for events in the next 24 hours, then sets `remindedAt`. Set `CRON_SECRET`; the handler skips authentication when it is unset. `lib/notify.ts` writes an in-app notification and attempts email according to preferences; failed email is logged, with no retry queue.

## Drive: built, configuration required

`lib/drive.ts` signs a service-account JWT with Node crypto and requests `drive.readonly`. Documents lists folders and searches names; editing happens in Drive. The three settings are blank in `.env.example`. Without them, `/api/board/documents` returns `configured: false`, which the frontend renders as “Google Drive isn't connected yet.”

Setup from `.env.example`:

1. Create a Google Cloud project and enable the Drive API.
2. Create a service account and JSON key. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` from `client_email` and `GOOGLE_SERVICE_ACCOUNT_KEY` from `private_key`.
3. Share only the intended club folder with that account as Viewer. Search uses the account's accessible files, not a root-folder ancestry check.
4. Set `GOOGLE_DRIVE_ROOT_FOLDER_ID` from the folder URL. The key accepts real newlines or literal `\n`.

## Checks and contributions

`.github/workflows/ci.yml` runs Node 24, `npm ci`, Prisma generation/migrations against a disposable Postgres service, lint, Vitest, TypeScript, and build. Locally: `npm run lint`, `npm test`, `npx tsc --noEmit`, `npm run build`. Database-backed tests need a dedicated test database; see their skip conditions before running them. See [AGENTS.md](AGENTS.md) for change and PR instructions.
