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

## What still needs building

This ships the auth foundation only. Not yet built (all discussed, none started):
- **Speaker self-service profile** — `GET/PATCH /api/speaker-profile` exists (name, LinkedIn, bio, plus the linked submission's organization/availability/needs/note), but there's no frontend page for it yet.
- **Exec-board speaker directory** — `GET /api/speakers` (board-only, full list) has existed since the intake system, but there's still no admin UI to browse it, see LinkedIn/resumes, or trigger `/invite`. This was already a gap before the portal idea.
- **Resume upload** — `User.resumeUrl` exists as a column; nothing writes to it yet. Needs blob storage (Vercel Blob is the natural pick, nothing else in the stack handles file uploads).
- **Notifications** — `Notification` model + `GET /api/notifications` + `PATCH /api/notifications/:id` (mark read) exist; nothing creates a notification yet, and there's no frontend inbox UI.
- **Email preferences** — `EmailPreference` model + `GET/PATCH /api/email-preferences` exist (two categories: `eventReminders`, `announcements`); nothing checks them before sending mail yet, because nothing sends notification mail yet.
- **Per-event public pages** (browse/RSVP without signing in) — this is a different feature, already tracked as roadmap Step 5 (`frontend`#4, `backend`#4), not part of the speaker-portal work. Don't rebuild it here.
