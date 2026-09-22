# Authentication

## Two account kinds, shared sessions

`prisma/schema.prisma` separates `AccountKind` (MEMBER or SPEAKER) from `Role` (MEMBER, BOARD, EXEC_BOARD). `auth.ts` registers no sign-in providers and uses Auth.js database sessions. Password handlers create those sessions through `lib/session.ts`.

`lib/password.ts` hashes passwords with salted Node scrypt. `lib/session.ts` creates a 30-day session and an HttpOnly, SameSite=Lax cookie, Secure for HTTPS. `auth.ts` explicitly selects session response fields; it does not return the password hash or session token.

## Members

`POST /api/auth/member-login` accepts `{ email, password }`. `lib/member-password.ts` normalizes the email and requires the exact configured `ALLOWED_EMAIL_DOMAIN`; an unset domain rejects member login. Passwords are case-sensitive and not trimmed. Login requires an existing MEMBER account with a valid password hash. It never creates an account or accepts a role.

The persistent `SignInLimit` counter permits ten attempts per email per 15-minute window. Login and issuance share a per-email Postgres transaction lock. `lib/password-request.ts` checks JSON content type and request origin for member login and credential issuance. Set `FRONTEND_URL` to the frontend's exact origin, without a trailing slash.

### Issuance and recovery

There are two entry points, both using `issueMemberPassword()`:

- Server administrator: `npx tsx scripts/issue-member-password.ts member@uic.edu`, with the intended database and domain loaded. The script requires an interactive terminal and refuses redirected output.
- Exec session: `POST /api/board/members/password` with `{ email }`. The route rejects guest accounts and self-reset, and returns the generated password once with `Cache-Control: no-store`.

The generated password is 24 base64url characters. Only its hash is stored. Issuance preserves existing roles and creates new accounts as MEMBER. It revokes that user's sessions and MCP tokens and deletes old email verification tokens in the same transaction. It does not send email. Deliver credentials privately after verifying the recipient.

`POST /api/auth/signup` is the public member signup route. Signed-out callers provide a name, an address in `ALLOWED_EMAIL_DOMAIN`, and a 10–200 character password; the password rules come from `passwordProblem()` in `lib/invite.ts`, so signup and invite claim cannot drift apart. It always creates MEMBER accounts with the MEMBER role and starts a session. It rejects a caller who already has one. Requests are limited to five attempts per normalized email per hour, and the existence check runs under the same per-email advisory lock as login and issuance.

An address that already has an account gets a 409 naming that fact. **This is an account enumeration oracle for university addresses, accepted deliberately.** The generic-response alternative does not work here: a new account is signed in, so its response carries `Set-Cookie` and the refusal does not, which distinguishes the two anyway — and it strands a returning member on a success screen with no session. If this ever has to genuinely hide, the only honest form is to stop creating the session in this route so both paths return a bare `{ ok: true }` and everyone signs in afterwards.

The script does not promote a new account to exec. The paired frontend provides signup and member-password login forms, but `src/components/dashboard/Members.tsx` still has no issuance UI.

## Guests

`POST /api/auth/speaker-login` accepts `{ username, password }` for SPEAKER accounts. The lookup also accepts email. No university domain is required. The username is trimmed/lowercased; the password is not. Its limiter is in-memory (`lib/rate-limit.ts`), unlike the member limiter.

### Single-use invitation

Execs create a draft through `POST /api/speakers/drafts`, or replace an unused guest link through `POST /api/speakers/:id/invite-link`. Both use `runsWorkspace()`, which is exec-only today. The frontend's `Speakers.tsx` turns the returned token into `/invite/[token]`.

`lib/invite.ts` generates 256 random bits, stores only a SHA-256 hash, and expires the link after 14 days. Minting a replacement overwrites the previous hash. Lookup rejects unknown, expired, used, or already-account-linked invitations.

`POST /api/invites/claim` accepts the token, name, email, and a guest-chosen password of 10–200 characters. It refuses already-signed-in callers and emails already assigned to an account. Claiming consumes the invite and creates a linked SPEAKER account transactionally, then creates the session. The email normally becomes the username; a collision gets a generated fallback. No forced password change or email delivery is needed.

### Older emailed invitation

`POST /api/speakers/:id/invite` still exists. It is exec-only and requires a submitted, non-declined submission without an account. It creates a username and temporary password, sets `mustChangePassword`, then emails the credentials. The successful response also returns the temporary password once.

The frontend sends these guests to `/speaker-signin/set-password`. `POST /api/auth/set-password` requires a SPEAKER session, the current password, and a new password of at least eight characters. It clears `mustChangePassword`. This route cannot change a MEMBER password.

The public speaker intake (`POST /api/speakers`) and old `/speak/[id]` completion flow create/update submissions, not accounts. Guest accounts require an invitation.

## Roles and guest stages

`lib/authz.ts` has separate account-aware board and exec predicates. `runsWorkspace()` is currently `isExecAccount()`. `lib/board-guard.ts` applies that gate to the workspace routes: budgets, items, roster, insights, documents, and credential issuance. BOARD gets the member dashboard and MCP tools for now. `Officer` is a display preference used by the frontend's `BoardHome.tsx`, not an access grant.

This workspace switch does not rewrite every older API's permissions. For example, event creation in `app/api/events/route.ts` still checks BOARD/EXEC_BOARD role directly. Read each handler's guard; do not assume every endpoint uses `runsWorkspace()`.

`lib/stage.ts` treats a SPEAKER account as SPEAKER only when its submission is CONFIRMED; other statuses are CANDIDATE. Role never promotes a guest into the workspace. `app/api/speaker-profile/route.ts` allows availability edits but rejects candidate edits to talk title/slides. Changing availability clears its confirmation unless the same request confirms the replacement windows. A linked Event supplies talk attendance and RSVP counts.

## MCP credentials

`app/api/mcp/route.ts` authenticates bearer tokens through `lib/mcp-token.ts`. Tokens are stored as SHA-256 hashes and resolve the caller's current stage on every request. Both tool discovery and invocation enforce stage access.

There are **38 registered tools** in `lib/mcp-tools.ts`. None can issue or reset a password; credential recovery stays in the script and the exec HTTP endpoint. `lib/stage.test.ts` verifies stage filtering and BOARD/member parity, and asserts that no tool name matches `/password/i` at any stage — so an agent cannot mint a credential even if someone adds a tool that tries to.

## Retired paths

`POST /api/auth/otp/verify` returns 410. `GET /api/dev/login` returns 404. Tests beside both handlers check the retirement. With `providers: []` in `auth.ts`, the old Nodemailer provider is not registered. Passwordless source remains under `archive/passwordless/`; it is not an active sign-in system.

The paired frontend's `/signin` still advertises passwordless login and calls those retired paths. That is an integration bug, not a supported alternative.
