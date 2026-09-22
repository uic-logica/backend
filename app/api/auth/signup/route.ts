import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { jsonBody } from "@/lib/board-guard";
import { passwordProblem } from "@/lib/invite";
import { normalizeMemberEmail } from "@/lib/member-password";
import { isAllowedEmail } from "@/lib/otp";
import { hashPassword } from "@/lib/password";
import { passwordRequestError } from "@/lib/password-request";
import { prisma } from "@/lib/prisma";
import { overAttemptLimit } from "@/lib/rate-limit";
import { attachSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const invalid = passwordRequestError(request);
  if (invalid) return invalid;

  const existingSession = await auth();
  if (existingSession?.user) {
    return NextResponse.json(
      { error: "You're already signed in.", reason: "signed-in" },
      { status: 409 },
    );
  }

  const body = await jsonBody(request);
  const email = normalizeMemberEmail(body?.email);
  if (!email || !isAllowedEmail(email)) {
    return NextResponse.json({ error: "Enter a valid UIC email address." }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) {
    return NextResponse.json({ error: "Enter your full name (up to 100 characters)." }, { status: 400 });
  }

  const badPassword = passwordProblem(body?.password);
  if (badPassword) return NextResponse.json({ error: badPassword }, { status: 400 });

  // Five attempts per address per hour matches the other public account-creation
  // surfaces and caps the deliberately expensive scrypt work below.
  if (overAttemptLimit(`signup:${email}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in an hour." }, { status: 429 });
  }

  // ponytail: this tells the caller that an address already has an account, which
  // is an enumeration oracle for @uic.edu addresses. The generic-response version
  // was written first and dropped: signing a new account in means the success
  // response carries Set-Cookie and the "already exists" one doesn't, so the two
  // are one request apart anyway — it bought nothing, and it stranded a returning
  // member on a success screen that then bounced them off /dashboard. The club
  // roster is already half-public on /team. If this ever needs to actually hide,
  // the only honest version is to stop creating the session here and make everyone
  // sign in afterwards, so both paths return a bare { ok: true }.
  const passwordHash = hashPassword(body?.password as string);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${email}))`;
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        { error: "That email already has a LOGICA account. Sign in instead.", reason: "exists" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    const user = await tx.user.create({
      data: { name, email, passwordHash, accountKind: "MEMBER", role: "MEMBER" },
      select: { id: true },
    });
    await attachSession(user.id, request, response, tx);
    return response;
  });
}
