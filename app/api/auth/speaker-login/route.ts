import { NextRequest, NextResponse } from "next/server";
import { attachSpeakerSession } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { overAttemptLimit } from "@/lib/rate-limit";

/**
 * POST { username, password } -> sets the session cookie directly (see
 * lib/session.ts for why this isn't an Auth.js Credentials provider).
 * SPEAKER accounts only.
 */
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { username: rawUsername, password } = (payload ?? {}) as Record<string, unknown>;
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";
  if (!username || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "`username` and `password` are required." }, { status: 400 });
  }

  // Rate-limited by username, not IP — a shared IP (campus wifi, a proxy)
  // shouldn't lock out everyone behind it, and the thing being protected is
  // this one account.
  if (overAttemptLimit(`speaker-login:${username}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  // Username or email. Guests who set up their own account through an
  // invite link have their email as their username, and they will type the
  // email — but the exec email-invite path still mints "ada.lovelace", so
  // both have to work. Both columns are unique, so this can't be ambiguous.
  const user = await prisma.user.findFirst({
    where: { OR: [{ username }, { email: username }] },
  });
  if (!user || user.accountKind !== "SPEAKER" || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  const response = NextResponse.json({
    id: user.id,
    username: user.username,
    mustChangePassword: user.mustChangePassword,
  });
  await attachSpeakerSession(user.id, request, response);
  return response;
}
