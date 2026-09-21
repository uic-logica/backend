# Authentication

## Member, board, and exec sign-in

All `accountKind: MEMBER` accounts now use their configured university email and an admin-issued generated password. `Role` still controls member/board/exec permissions; login cannot set or change it. No public account creation or email code login is enabled.

- `POST /api/auth/member-login` accepts `{ email, password }`, normalizes the email, checks the exact `ALLOWED_EMAIL_DOMAIN`, and creates an Auth.js database session. Passwords are case-sensitive and are never trimmed. Invalid input, wrong passwords, and wrong account kinds never create sessions.
- Ten attempts per address per 15-minute window, counted atomically in Postgres using the existing `SignInLimit` table. Limits persist across instances and restarts. Successful sign-in does not clear the counter. No schema migration is needed.
- Passwords have 24 base64url characters (144 random bits) and are hashed using Node scrypt with a random salt. Only the hash is saved. Hash format validation rejects corrupt or empty hashes before comparison.
- `POST /api/board/members/password` is restricted server-side to MEMBER accounts with EXEC_BOARD role. It accepts `{ email }`, generates a new credential, creates a MEMBER account if needed, and preserves existing roles. It rejects guest accounts and self-reset. The response reveals the password once with `Cache-Control: no-store`.
- Issuance revokes all existing sessions and MCP tokens, and removes old email codes in the same transaction. Login and issuance use the same per-email transaction lock so a concurrent old-password login cannot survive a reset.
- Deliver issued passwords privately after checking identity; users should store them in a password manager. There is no email delivery dependency. Lost passwords are reset by another exec, or a server administrator using the command below. Member-selected passwords are not enabled.
- JSON content type and origin checks protect credential mutations. Set `FRONTEND_URL` to the exact public frontend origin (for example `https://club.example.edu`, without a trailing slash) when using the frontend API proxy. Locally set it to `http://localhost:3000`. If unset, only the request URL's own origin is accepted.

## Bootstrap and recovery

Before switching the frontend, issue credentials to at least one **existing exec account** from an interactive administrator terminal with the intended Logica `DATABASE_URL` and `ALLOWED_EMAIL_DOMAIN` loaded:

```sh
npx tsx scripts/issue-member-password.ts existing-exec@uic.edu
```

This generates a password and displays it once. It never promotes accounts; a new email receives MEMBER access. Existing roles, profile data, memberships, and attendance remain intact. It refuses redirected output to reduce accidental credential logging. Do not run it against another project's database. Use the exec dashboard's Members section to provision/reset the remaining accounts. If delivery of a password fails, issue a fresh one; hashes cannot be reversed.

Deploy backend first, configure `FRONTEND_URL`, provision the exec, then deploy frontend. Existing sessions remain until expiration or credential issuance; each issued password revokes that user's sessions and MCP connections. No production data is modified by building or deploying the code itself.

## Passwordless archive

The prior provider and verification route are preserved in `archive/passwordless/` along with a restoration checklist. Auth.js has no registered sign-in providers, so old Nodemailer callback URLs cannot issue sessions. `/api/auth/otp/verify` returns 410. The archive is not compiled or routed. Keep the existing verification tables until the future auth decision is made. The development role-switcher `/api/dev/login` is also retired (404) so it cannot bypass password login.

## Speakers and guests

Speaker/guest username + password sign-in remains at `/api/auth/speaker-login`; their invite and forced password-change flows are unchanged. MEMBER passwords cannot be changed through the speaker-only `/api/auth/set-password` endpoint. `AccountKind` is separate from `Role`: speakers never gain board access from a role value.

## Session contract

`lib/session.ts` creates Auth.js-compatible database sessions directly because the Credentials provider does not support this application's database-session strategy. The session cookie is HttpOnly, SameSite=Lax, and Secure on HTTPS, using Auth.js's cookie name. The session response explicitly excludes password hashes and session tokens. Existing Auth.js CSRF-protected sign-out continues to work.

## Notifications + email routing

`lib/notify.ts` is the one place anything "tell a user something" goes through:

- `notifyUser(userId, message, category)` — writes the in-app `Notification`, then emails the same message unless that `EmailPreference` category is off (`eventReminders` or `announcements`; missing preference row = on, matching the GET default).
- `notifyEventGoing(eventId, message, category, exceptUserId?)` — same, fanned out to everyone `RSVP`'d `GOING` to that event.

Wired into three trigger points so far:
1. `PATCH /api/speakers/:id` confirming/declining a submission → `notifyUser` (category `announcements`) if that submission has a linked portal account.
2. `POST /api/events/:id/feed` (a note posted to an event) → `notifyEventGoing` (category `eventReminders`), excluding the poster.
3. `POST /api/events/:id/materials` with `visibility: "PUBLIC"` → `notifyEventGoing` (category `eventReminders`).

ponytail: fire-and-forget, no retry queue — a failed email is logged (`console.error`) and the in-app notification stays either way. No automatic reminders (e.g. "event tomorrow") — that needs a scheduled job, and nothing in this stack runs one yet; add a cron trigger calling `notifyEventGoing` when that's actually needed, don't build the scheduler speculatively.

## File uploads: resumes and event materials

Both stored as `Bytes` columns directly in Postgres via `lib/upload.ts`'s `parseUpload()` — a shared `{ filename, mimeType, data: <base64> }` JSON shape, not multipart/form-data (every other endpoint in this app is already JSON; a form-data parser for one feature isn't worth it). Size-capped (resumes 5MB, event materials 15MB) since they land in the database.

- **Resumes** — any signed-in user, `POST/DELETE /api/profile/resume`, downloaded via `GET /api/resume/:userId` (self, or board+ reviewing who's signed up). One resume per user, referenced through their RSVPs — not stored per-event, since a person's resume doesn't change per event they attend.
- **Event materials** — board+ only to upload (`POST /api/events/:id/materials`), with a `visibility: "PUBLIC" | "INTERNAL"` field. `GET /api/events/:id/materials` filters to `PUBLIC` for anyone who isn't board (including signed-out requests — public materials are meant to be public); `GET /api/materials/:id/download` enforces the same split.

ponytail: Postgres, not object storage — fine at the current scale (a handful of small PDFs/slide decks). Move to Vercel Blob or S3 if files get large or numerous; nothing else in the stack currently handles file uploads at all, so this was the smallest thing that could actually ship rather than a placeholder waiting on new infra.

## Event feed

`Post` gained a nullable `eventId` — a post with one set is that event's feed instead of the general one. Same model, same shape, `GET/POST /api/events/:id/feed` mirror the general `/api/posts` routes. No separate model, no new permissions: same "any signed-in user" rule as the general feed.

## Public events + scheduled reminders + the admin directory

Three more pieces, same pass:

- **`GET /api/events` and `GET /api/events/:id` are public now** — no auth required. They were board-gated before, which meant `/events` (a public marketing page) 401'd for every signed-out visitor. Events have no sensitive fields (title/description/location/time), so there was no reason for the gate. `POST /api/events` (create) is still board+ only.
- **`GET /api/speakers` includes the linked portal account** (`user: { id, username, linkedin, resumeFilename }`) when one exists — this is what the admin speaker directory reads to show LinkedIn/resume alongside each submission.
- **Scheduled reminders**: `app/api/cron/event-reminders` + `vercel.json`. Vercel Cron hits it daily; it reminds everyone `RSVP`'d `GOING` to anything starting in the next 24h, once per event (`Event.remindedAt`). Protected by `CRON_SECRET` (set on Vercel; unset locally skips the check — see `.env.example`). ponytail: daily cron + 24h window means "reminded sometime the day before," not an exact offset — tighten later if that precision matters. No new infra: Vercel Cron is a native platform feature, not a new dependency.

## What still needs building

- **Frontend for the admin directory** — `GET /api/speakers` now returns everything the page needs (contact info, status, LinkedIn, resume, draft state), but there's no `/admin/speakers`-style page yet to browse/confirm/decline/invite from.
- Everything else already listed above (resume/materials/feed UI) is now built — see the frontend PRs.
