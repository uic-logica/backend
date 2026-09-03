# LOGICA @ UIC — backend

Headless Next.js API (App Router route handlers only, no pages). Auth, roles, and data live here; the [`frontend`](https://github.com/uic-logica/frontend) repo calls into this.

## Stack

- Next.js 16 (API routes only)
- Prisma + Postgres
- Passwordless auth — no Google OAuth, no passwords; a one-time 6-digit code emailed to the user, restricted to `ALLOWED_EMAIL_DOMAIN` (`.edu`), roles stored on `User.role` (`MEMBER` / `BOARD` / `EXEC_BOARD`) — see [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md) Step 2 and backend#10.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local`, fill in `DATABASE_URL` (a free Supabase Postgres works fine for dev), generate `AUTH_SECRET` (`npx auth secret`), and fill in the SMTP vars (`EMAIL_SERVER_HOST`/`PORT`/`USER`/`PASSWORD`, `EMAIL_FROM`) used to send the one-time sign-in code — see Step 2 in [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md). For local dev, generate a throwaway [Ethereal](https://ethereal.email) mailbox rather than wiring up a real inbox — see the comments in `.env.example`. Real sending goes through a dedicated `logica.noreply@gmail.com` account (ask a maintainer for the App Password); it's a stopgap until the club has its own domain, which the public website needs anyway, and switching is an `.env` change rather than a code change.
3. `npx prisma migrate dev --name init`
4. `npm run dev`

## Where things are

- `prisma/schema.prisma` — data model. Add new tables here as new features (feed, events, attendance, forms) come online — see the repo's issues for what's next.
- `auth.ts` — auth config: passwordless one-time emailed code, `.edu` domain restriction via `ALLOWED_EMAIL_DOMAIN`, session/role callback.
- `app/api/auth/[...nextauth]/route.ts` — auth endpoint, don't touch unless changing providers.
- `app/api/auth/otp/verify/route.ts` — `POST {email, code}` exchanges an emailed sign-in code for a session cookie. This is the endpoint the frontend calls; Auth.js's own callback is shaped for a link click and can't be driven from a form.
- `lib/prisma.ts` — shared Prisma client, import this everywhere instead of `new PrismaClient()`.
- `app/api/profile`, `/posts`, `/events`, `/attendance`, `/forms` + their `Post`/`Event`/`Rsvp`/`Attendance`/`Form` models — **bare-minimum, throwaway scaffolding** for Steps 3–7 (`logica-lean`-marked throughout, see each roadmap issue's comments for specifics). A rough starting reference, not a finished implementation — attendance in particular has no real check-in verification yet.
- `prisma/seed.ts` — throwaway local dev sample data matching the scaffolding above. Not wired into CI or `prisma migrate`; run with `npx tsx prisma/seed.ts`.

## Workflow

See the org-wide [CONTRIBUTING.md](https://github.com/uic-logica/.github/blob/main/CONTRIBUTING.md) — branch off `main`, PR, review, merge. CI runs lint + typecheck + build on every PR.

New here? Read [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md) and the [backend role guide](https://github.com/uic-logica/.github/blob/main/docs/roles/backend.md) first, then pick up an open issue labeled `roadmap`.

Using Claude Code? Install the [`skills`](https://github.com/uic-logica/skills) plugin for `/logica-pr`, `/logica-review`, `/logica-test`, `/logica-issue`, and `/logica-lean`.
