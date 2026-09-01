# LOGICA @ UIC — backend

Headless Next.js API (App Router route handlers only, no pages). Auth, roles, and data live here; the [`frontend`](https://github.com/uic-logica/frontend) repo calls into this.

## Stack

- Next.js 16 (API routes only)
- Prisma + Postgres
- Passwordless auth — no Google OAuth, no passwords; a one-time 6-digit code emailed to the user, restricted to `ALLOWED_EMAIL_DOMAIN` (`.edu`), roles stored on `User.role` (`MEMBER` / `BOARD` / `EXEC_BOARD`) — see [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md) Step 2 and backend#10.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local`, fill in `DATABASE_URL` (a free Neon Postgres works fine for dev), generate `AUTH_SECRET` (`npx auth secret`), and fill in the SMTP vars (`EMAIL_SERVER_HOST`/`PORT`/`USER`/`PASSWORD`, `EMAIL_FROM`) used to send the one-time sign-in code — see Step 2 in [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md). For local dev, generate a throwaway [Ethereal](https://ethereal.email) mailbox rather than wiring up a real inbox — see the comments in `.env.example`. **The production email sender is deliberately undecided**, parked until the club has its own domain (which the public website needs anyway); switching to it is an `.env` change, not a code change.
3. `npx prisma migrate dev --name init`
4. `npm run dev`

## Where things are

- `prisma/schema.prisma` — data model. Add new tables here as new features (feed, events, attendance, forms) come online — see the repo's issues for what's next.
- `auth.ts` — auth config: passwordless one-time emailed code, `.edu` domain restriction via `ALLOWED_EMAIL_DOMAIN`, session/role callback.
- `app/api/auth/[...nextauth]/route.ts` — auth endpoint, don't touch unless changing providers.
- `lib/prisma.ts` — shared Prisma client, import this everywhere instead of `new PrismaClient()`.

## Workflow

See the org-wide [CONTRIBUTING.md](https://github.com/uic-logica/.github/blob/main/CONTRIBUTING.md) — branch off `main`, PR, review, merge. CI runs lint + typecheck + build on every PR.

New here? Read [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md) and the [backend role guide](https://github.com/uic-logica/.github/blob/main/docs/roles/backend.md) first, then pick up an open issue labeled `roadmap`.

Using Claude Code? Install the [`skills`](https://github.com/uic-logica/skills) plugin for `/logica-pr`, `/logica-review`, `/logica-test`, `/logica-issue`, and `/logica-lean`.
