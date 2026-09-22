<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Work from the implementation

Read the affected route, its `lib/` helpers, and `prisma/schema.prisma` before changing behavior. Markdown and code comments can describe older plans. `package.json` declares the stack; `.github/workflows/ci.yml` defines checks.

- Import the shared client from `lib/prisma.ts`. Ship schema changes with a migration in `prisma/migrations/`.
- Use account-aware checks in `lib/authz.ts`. `runsWorkspace()` is EXEC_BOARD-only; BOARD has the member workspace view. `Officer` grants no permissions.
- Start workspace handlers with `requireBoard()` from `lib/board-guard.ts`. Keep server-side authorization even when the frontend hides controls.
- Reuse `lib/board-item.ts`: MONEY and OUTREACH share `BoardItem`, stage validation, and budget rollups. Do not add a parallel company/expense model for the same data.
- Read `AUTH.md` and the actual auth handlers before touching credentials. Member passwords are issued through the script or exec endpoint; guest invites can accept a guest-chosen password. Do not restore OTP or the dev login bypass incidentally.
- Keep password issuance/reset out of MCP. Update the registry and stage tests together when changing tools. Count `TOOLS` in `lib/mcp-tools.ts`, not a number copied from an old plan.
- Drive is read-only in `lib/drive.ts`; missing configuration is an explicit empty state, not a reason to add fixtures.
- Keep env files and credentials out of commits. `.gitignore` permits only `.env.example` among env files.

## Checks

Use the existing Vitest runner (`npm test`, `vitest.config.ts`). Route tests import handlers directly; `lib/stage.test.ts` covers tool permissions. Include wrong-account/wrong-role cases for permission changes. Do not add another test runner.

Before pushing, run `npm run lint` and `npx tsc --noEmit`. Generate the client first with `npx prisma generate`. CI also runs migrations, `npm test`, and `npm run build`, against its own Postgres service. Use a dedicated test database for DB-backed tests; inspect their skip conditions. Never point tests or migrations at an unrelated database.

Build with `npm run build` so Prisma generation precedes Next. Migrations are separate: `prisma.config.ts` reads `DATABASE_URL`; override it for the migration connection rather than adding `directUrl`.

## Branches and PRs

Work on `<name>/<short-description>`, not `main`; keep an already-supplied task branch. Open a PR against `main` with 1–3 summary bullets, the linked tracking issue (`Closes #<issue>` when completed), and a test plan. Do not self-merge. `.github/CODEOWNERS` assigns review to `@uic-logica/maintainers`; do not claim a particular approval count from that file.

Link a roadmap-labeled tracking issue; reuse an existing one or file one for the task. Keep changes within its scope. Prefer the current helpers and Node APIs to new plumbing or dependencies. Preserve input validation and authorization when simplifying. Existing deliberate deferrals use `// logica-lean: <ceiling> — revisit if <trigger>`.
