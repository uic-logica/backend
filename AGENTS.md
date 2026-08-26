<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## LOGICA @ UIC workflow

Follows [CONTRIBUTING.md](https://github.com/uic-logica/.github/blob/main/CONTRIBUTING.md) and [ROADMAP.md](https://github.com/uic-logica/.github/blob/main/ROADMAP.md). Claude Code gets these as `/logica-*` skills from the `uic-logica/skills` marketplace; this is the same content for Codex, Cursor, or anyone else reading `AGENTS.md`.

### Opening a PR
- Never push straight to `main` — branch protection blocks it. `git checkout -b <name>/<short-description>`.
- Run `npm run lint` and `npx tsc --noEmit` before pushing — CI runs the same checks.
- Every PR links a `roadmap`-labeled tracking issue (`gh issue list --label roadmap`); file one first if it doesn't exist.
- PR body: 1-3 bullet summary, `Closes #<issue>`, a test plan. Don't self-merge — one approval + passing lint required.

### Reviewing a diff
- No secrets staged (`.env*` beyond `.env.example`), no scope creep past the linked issue.
- **Role checks happen server-side**, not just hidden behind a frontend button — a `MEMBER` request should never reach what only `BOARD`/`EXEC_BOARD` can do.
- **Every schema change ships a migration** (`prisma/migrations/...`) — no hand-edited database assumptions.
- **Prisma client only from `lib/prisma.ts`** — never `new PrismaClient()` inline, that exhausts connections in dev.
- Auth/session logic untouched unless the PR is specifically about auth — it's shared infrastructure.

### Writing tests
- Use whatever runner is already configured (check `package.json` scripts, existing `*.test.*` files) — ask before adding a new one.
- Scope the test to the change, not exhaustive coverage.
- Test handler functions directly (import + call with a constructed request) rather than a real HTTP server, unless the PR is about request/response wiring.
- If the code touches the DB, test against the real schema shape — use a real/test database or Prisma's mock client, not a hand-rolled fake that can drift from `prisma/schema.prisma`.
- Role checks need a "wrong role gets rejected" test case.

### Filing issues
- Title: `[Step N] ...` for a roadmap step, `[Addition] ...` for an Additions-list item, plain title otherwise.
- Reuse existing labels (`gh label list -R uic-logica/backend`) — roadmap issues get `roadmap` + `backend` + `enhancement` (skip `enhancement` for foundational work).
- Body links the roadmap step/section and ends with a concrete "done when" line.

### Keeping it lean
1. Does this need to exist yet, or is it ahead of the current roadmap step?
2. Check `prisma/schema.prisma` before a new data structure, parallel source of truth, or cache.
3. Reuse `lib/` (especially `lib/prisma.ts`) before writing new plumbing.
4. Can it be one line?
5. Only then, the minimum new code that works.

Mark deliberate shortcuts inline: `// logica-lean: <ceiling> — revisit if <trigger>`. Never simplify away role checks or input validation at API boundaries.
