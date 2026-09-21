import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  hashInvite,
  INVITE_PROBLEM,
  lookupInvite,
  normalizeEmail,
  passwordProblem,
} from "@/lib/invite";
import { hashPassword, slugifyUsername } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { overAttemptLimit } from "@/lib/rate-limit";
import { attachSpeakerSession } from "@/lib/session";

/**
 * Public — the guest claiming their link. Picks an email and a password,
 * gets a SPEAKER account, and is signed in by the time this returns, so
 * they land on their own dashboard rather than a "now go check your inbox"
 * screen.
 *
 * This replaces the two-step flow (board sends a draft link, exec later
 * emails a temp password) with one link. The exec email invite still
 * exists for guests who never click anything; both refuse to run twice,
 * because `user` on the submission is the thing either one sets.
 */
export async function POST(request: NextRequest) {
  // A board member checking that their own link works would otherwise burn
  // it — the link is single-use — and sign themselves out of their board
  // account in the process. Both are easy to do and confusing to undo, so
  // this refuses before touching anything.
  const existing = await auth();
  if (existing?.user) {
    return NextResponse.json(
      {
        error:
          "You're already signed in. Open this link in a private window — using it here would sign you out and spend the guest's one-time link.",
        reason: "signed-in",
      },
      { status: 409 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const body = (payload ?? {}) as Record<string, unknown>;

  // Keyed by the link, not the caller's IP — same reasoning as the speaker
  // login limiter: two guests on the same campus wifi must not be able to
  // lock each other out of signing up. A budget per link protects the one
  // thing worth protecting, and grinding for valid links is capped
  // separately (and by IP) on /api/invites/lookup.
  if (overAttemptLimit(`invite-claim:${hashInvite(String(body.token ?? ""))}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many attempts on this link. Try again in an hour, or ask for a new one." },
      { status: 429 },
    );
  }

  const found = await lookupInvite(body.token);
  if (!found.ok) {
    return NextResponse.json(
      { error: INVITE_PROBLEM[found.reason], reason: found.reason },
      { status: found.reason === "unknown" ? 404 : 410 },
    );
  }
  const { submission } = found;

  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const badPassword = passwordProblem(body.password);
  if (badPassword) return NextResponse.json({ error: badPassword }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Tell us your name." }, { status: 400 });

  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json(
      { error: "That email already has an account. Sign in instead, or use another address." },
      { status: 409 },
    );
  }

  // They sign in with their email, so that is the username. slugifyUsername
  // stays the fallback for the exec email-invite path, which has no email
  // chosen by the guest.
  let username = email;
  for (let suffix = 2; await prisma.user.findUnique({ where: { username } }); suffix++) {
    username = `${slugifyUsername(name, email)}-${suffix}`;
  }

  // One transaction: burning the invite and creating the account have to
  // succeed or fail together, or a crash between them leaves a guest with
  // a dead link and no way in.
  const user = await prisma.$transaction(async (tx) => {
    const burned = await tx.speakerSubmission.updateMany({
      // The null check is the race guard: two clicks on the same link at
      // the same moment, and only one of them matches.
      where: { id: submission.id, inviteUsedAt: null },
      data: {
        inviteUsedAt: new Date(),
        name,
        email,
        // Claiming the link is them telling us who they are, which is what
        // "submitted" has always meant here. The board can act on it now.
        submittedAt: new Date(),
      },
    });
    if (burned.count === 0) throw new Error("ALREADY_CLAIMED");

    return tx.user.create({
      data: {
        name,
        email,
        accountKind: "SPEAKER",
        username,
        passwordHash: hashPassword(body.password as string),
        // They chose it themselves — nothing to force them to change.
        mustChangePassword: false,
        speakerSubmissionId: submission.id,
      },
    });
  }).catch((error: Error) => {
    if (error.message === "ALREADY_CLAIMED") return null;
    throw error;
  });

  if (!user) {
    return NextResponse.json({ error: INVITE_PROBLEM.used, reason: "used" }, { status: 410 });
  }

  const response = NextResponse.json(
    { id: user.id, username: user.username, kind: submission.kind },
    { status: 201 },
  );
  await attachSpeakerSession(user.id, request, response);
  return response;
}
