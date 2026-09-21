# LOGICA @ UIC — backend

Headless Next.js API (App Router route handlers only, no pages). Auth, roles, and data live here; the [`frontend`](https://github.com/uic-logica/frontend) repo calls into this.

## Stack

- Next.js 16 (API routes only)
- Prisma + Postgres
- Two sign-in systems: admin-issued generated passwords for `MEMBER` accounts (`Role`: `MEMBER`/`BOARD`/`EXEC_BOARD`), username + password for `SPEAKER` accounts (external guests, no `.edu` needed). **See [AUTH.md](AUTH.md) before touching anything auth-related** — the two systems work differently on purpose and it explains why.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local`, fill in `DATABASE_URL` (a free Supabase Postgres works fine for dev), generate `AUTH_SECRET` (`npx auth secret`), and fill in the SMTP vars (`EMAIL_SERVER_HOST`/`PORT`/`USER`/`PASSWORD`, `EMAIL_FROM`) used for guest invitations and notifications (member password sign-in does not use email) — see Step 2 in [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md). For local dev, generate a throwaway [Ethereal](https://ethereal.email) mailbox rather than wiring up a real inbox — see the comments in `.env.example`. Real sending goes through a dedicated `logica.noreply@gmail.com` account (ask a maintainer for the App Password); it's a stopgap until the club has its own domain, which the public website needs anyway, and switching is an `.env` change rather than a code change.
3. `npx prisma migrate dev --name init`
4. `npm run dev` — serves on port 3001, which is where the `frontend` repo expects it (it runs on 3000 and proxies `/api/*` here).

## Where things are

- `prisma/schema.prisma` — data model. Add new tables here as new features (feed, events, attendance, forms) come online — see the repo's issues for what's next.
- `auth.ts` — database session configuration and safe session/role callback. Member password login enforces `ALLOWED_EMAIL_DOMAIN`. See [AUTH.md](AUTH.md) for the full picture, including `SPEAKER` accounts, which this file only partly covers.
- `app/api/auth/[...nextauth]/route.ts` — auth endpoint, don't touch unless changing providers.
- `app/api/auth/member-login/route.ts` — email + generated password login for all member roles.
- `app/api/board/members/password/route.ts` — exec-only credential issuance and recovery.
- `app/api/auth/otp/verify/route.ts` — retired endpoint returning 410; prior implementation is in `archive/passwordless/`.
- `lib/member-password.ts` — generated credentials, revocation, and persistent password-attempt limits. `lib/sign-in-limit.ts` remains as archived OTP support.
- `app/api/auth/speaker-login/route.ts`, `app/api/auth/set-password/route.ts`, `lib/session.ts`, `lib/password.ts` — the `SPEAKER` account sign-in system. Not Auth.js providers — see AUTH.md for why.
- `lib/prisma.ts` — shared Prisma client, import this everywhere instead of `new PrismaClient()`.
- `app/api/profile`, `/posts`, `/events`, `/attendance`, `/forms` + their `Post`/`Event`/`Rsvp`/`Attendance`/`Form` models — **bare-minimum, throwaway scaffolding** for Steps 3–7 (`logica-lean`-marked throughout, see each roadmap issue's comments for specifics). A rough starting reference, not a finished implementation. Attendance is past that: see below.
- Attendance check-in: a board member opens a code with `POST /api/events/:id/check-in-code` (expires after 3 hours), members check in with `POST /api/attendance/checkin {eventId, code}`, and the door can check someone in by email with `POST /api/events/:id/attendance`.
- `app/api/join` — membership applications from the `/join` page: public `POST`, board-only `GET` and `PATCH /:id` to set the status.
- `prisma/seed.ts` — throwaway local dev sample data matching the scaffolding above. Not wired into CI or `prisma migrate`; run with `npx tsx prisma/seed.ts`.
- `app/api/speakers/*` — the speaker intake + portal system (public intake form's backend, EXEC_BOARD's `/invite` to create a portal account, `/api/speaker-profile`, `/api/notifications`, `/api/email-preferences`). See AUTH.md for the account side, `lib/speaker-submission.ts` for the intake-form data shape.
- `lib/notify.ts` — every "tell a user something" path (in-app + email, respecting their `EmailPreference`) goes through this. `lib/upload.ts` — shared file-upload parsing for resumes (`/api/profile/resume`, `/api/resume/:userId`) and event materials (`/api/events/:id/materials`, `/api/materials/:id/download`). `app/api/events/[id]/feed` — per-event notes (`Post.eventId`). All documented together in AUTH.md.

## Workflow

See the org-wide [CONTRIBUTING.md](https://github.com/uic-logica/.github/blob/main/CONTRIBUTING.md) — branch off `main`, PR, review, merge. CI runs lint, tests (against a throwaway Postgres), typecheck and build on every PR.

New here? Read [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md) and the [backend role guide](https://github.com/uic-logica/.github/blob/main/docs/roles/backend.md) first, then pick up an open issue labeled `roadmap`.

Using Claude Code? Install the [`skills`](https://github.com/uic-logica/skills) plugin for `/logica-pr`, `/logica-review`, `/logica-test`, `/logica-issue`, and `/logica-lean`.
