# Auth

Two sign-in systems, two very different account types. Read this before touching `auth.ts`, `lib/session.ts`, `lib/password.ts`, or anything under `app/api/auth/`.

## The two account kinds

| | `MEMBER` | `SPEAKER` |
|---|---|---|
| Who | UIC students/board | External guests confirmed via `/speak` |
| Sign in | `.edu` email + one-time code | Username + password |
| Created by | Signing in for the first time | EXEC_BOARD inviting a confirmed `SpeakerSubmission` |
| What `Role` means | `MEMBER`/`BOARD`/`EXEC_BOARD` govern access | Nothing — always defaults to `MEMBER`, ignored |
| Where it lives | `User.accountKind = MEMBER` | `User.accountKind = SPEAKER` |

`Role` and `AccountKind` are separate columns on purpose. `Role` is "how much club access" and only makes sense for people who are actually in the club. `AccountKind` is "which sign-in system got you here at all." Don't conflate them — a `SPEAKER` account with `role: EXEC_BOARD` should never happen and nothing should ever check for it.

## MEMBER sign-in (unchanged)

Passwordless, `.edu`-restricted, exactly as before: Auth.js's `Nodemailer` provider emails a 6-digit code, `isAllowedEmail()` fails closed if `ALLOWED_EMAIL_DOMAIN` is unset, `POST /api/auth/otp/verify` exchanges the code for a session. See the comments in `auth.ts` and `lib/otp.ts`.

## SPEAKER sign-in (new)

**How an account gets created:** a `SpeakerSubmission` (from `/speak`, see `lib/speaker-submission.ts`) reaches `status: CONFIRMED`. An EXEC_BOARD member calls `POST /api/speakers/:id/invite`, which:
1. Generates a username from their name (`lib/password.ts`'s `slugifyUsername`, deduped with `-2`, `-3`... on collision).
2. Generates a random temporary password, hashes it (`scrypt`, see below), creates the `User` row with `accountKind: SPEAKER` and `mustChangePassword: true`, and links it to the submission (`speakerSubmissionId`).
3. Emails the username + temp password (`lib/speaker-email.ts`), and also returns the temp password once in the API response as a fallback if the email doesn't land.

**How they sign in:** `POST /api/auth/speaker-login` with `{ username, password }`. Rate-limited 10 attempts / 15 min **per username** (not IP — a shared IP like campus wifi shouldn't lock out everyone behind it).

**First login:** the session comes back with `mustChangePassword: true`. The frontend must gate on this and force `POST /api/auth/set-password` (`{ currentPassword, newPassword }`, min 8 characters) before letting them into anything else. `currentPassword` is required even on that first forced change — a session hijacked mid-flow shouldn't be able to lock the real owner out.

### Why this isn't an Auth.js `Credentials` provider

We tried that first. **It doesn't work with `session: { strategy: "database" }`** — verified empirically, not from documentation: `authorize()` runs and returns a user, Auth.js issues a `302` with a `Set-Cookie`, but the cookie is a JWT-encoded blob, no row is ever written to the `Session` table, and `auth()` / `/api/auth/session` both come back empty on the very next request. This matches Auth.js v4's long-standing "Credentials requires JWT sessions" restriction — it still effectively holds in v5 with the Prisma adapter, it just doesn't throw an error telling you so.

The options were: run a second Auth.js instance with `session: { strategy: "jwt" }` just for speakers (two cookie names, two configs to keep in sync), or skip the provider abstraction and create the database session ourselves. We did the second one — `lib/session.ts`'s `attachSpeakerSession()`:
- Writes a `Session` row directly (`sessionToken`, `userId`, `expires` — same shape the Prisma adapter uses).
- Sets the cookie **by hand**, matching Auth.js's own naming exactly: `authjs.session-token` over HTTP, `__Secure-authjs.session-token` over HTTPS (checked via the request's own protocol, same logic Auth.js uses internally — see `@auth/core`'s `defaultCookies()`).

Because the Session row and cookie are shaped identically to what the adapter itself would create, `auth()` reads a SPEAKER session exactly like a MEMBER one everywhere else in the app — every existing route that calls `auth()` and checks `session.user.*` needed zero changes to also work for speakers. If you ever touch this: the contract that matters is "a row in `Session` plus a correctly-named cookie holding its `sessionToken`." Don't let it drift from what `@auth/core` expects, or `auth()` silently stops recognizing these sessions.

### Password hashing

`lib/password.ts`, built on Node's built-in `crypto.scrypt` — no bcrypt/argon2 dependency. Stored as `scrypt:<salt-hex>:<hash-hex>`, timing-safe compare on verify. Temp passwords are 12 characters of `crypto.randomBytes`, base64url-encoded.

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
