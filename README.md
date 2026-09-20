# LOGICA @ UIC — backend

Headless Next.js API (App Router route handlers only, no pages). Auth, roles, and data live here; the [`frontend`](https://github.com/uic-logica/frontend) repo calls into this.

## Stack

- Next.js 16 (API routes only)
- Prisma + Postgres
- Two sign-in systems: passwordless `.edu` one-time codes for `MEMBER` accounts (`Role`: `MEMBER`/`BOARD`/`EXEC_BOARD`), username + password for `SPEAKER` accounts (external guests, no `.edu` needed). **See [AUTH.md](AUTH.md) before touching anything auth-related** — the two systems work differently on purpose and it explains why.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local`, fill in `DATABASE_URL` (a free Supabase Postgres works fine for dev), generate `AUTH_SECRET` (`npx auth secret`), and fill in the SMTP vars (`EMAIL_SERVER_HOST`/`PORT`/`USER`/`PASSWORD`, `EMAIL_FROM`) used to send the one-time sign-in code — see Step 2 in [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md). For local dev, generate a throwaway [Ethereal](https://ethereal.email) mailbox rather than wiring up a real inbox — see the comments in `.env.example`. Real sending goes through a dedicated `logica.noreply@gmail.com` account (ask a maintainer for the App Password); it's a stopgap until the club has its own domain, which the public website needs anyway, and switching is an `.env` change rather than a code change.
3. `npx prisma migrate dev --name init`
4. `npm run dev` — serves on port 3001, which is where the `frontend` repo expects it (it runs on 3000 and proxies `/api/*` here).

## Where things are

- `prisma/schema.prisma` — data model. Add new tables here as new features (feed, events, attendance, forms) come online — see the repo's issues for what's next.
- `auth.ts` — auth config for `MEMBER` accounts: passwordless one-time emailed code, `.edu` domain restriction via `ALLOWED_EMAIL_DOMAIN`, session/role callback. See [AUTH.md](AUTH.md) for the full picture, including `SPEAKER` accounts, which this file only partly covers.
- `app/api/auth/[...nextauth]/route.ts` — auth endpoint, don't touch unless changing providers.
- `app/api/auth/otp/verify/route.ts` — `POST {email, code}` exchanges an emailed sign-in code for a session cookie. This is the endpoint the frontend calls; Auth.js's own callback is shaped for a link click and can't be driven from a form.
- `lib/sign-in-limit.ts` — sign-in limits, stored in Postgres: 5 codes per address per hour, 5 guesses per code. Applies to both the verify endpoint and Auth.js's callback.
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
