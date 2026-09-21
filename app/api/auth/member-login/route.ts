import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonBody } from "@/lib/board-guard";
import { allowPasswordAttempt, normalizeMemberEmail } from "@/lib/member-password";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordRequestError } from "@/lib/password-request";
import { attachSession } from "@/lib/session";

// Equal hashing work for unknown and existing accounts.
const dummyHash = hashPassword("unused-dummy-credential");

export async function POST(request: NextRequest) {
  const invalid = passwordRequestError(request);
  if (invalid) return invalid;
  const body = await jsonBody(request);
  const email = normalizeMemberEmail(body?.email);
  const password = body?.password;
  if (!email || typeof password !== "string" || !password || password.length > 128) {
    return NextResponse.json({ error: "Enter your university email and password (up to 128 characters)." }, { status: 400 });
  }
  if (!(await allowPasswordAttempt(email))) {
    return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429, headers: { "Retry-After": "900" } });
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${email}))`;
    const user = await tx.user.findUnique({ where: { email } });
    const valid = verifyPassword(password, user?.passwordHash || dummyHash);
    if (!valid || !user?.passwordHash || user.accountKind !== "MEMBER") {
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    await attachSession(user.id, request, response, tx);
    return response;
  });
}
