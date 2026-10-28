import { NextRequest, NextResponse } from "next/server";
import { jsonBody } from "@/lib/board-guard";
import { hashInvite, passwordProblem } from "@/lib/invite";
import { hashPassword } from "@/lib/password";
import { passwordRequestError } from "@/lib/password-request";
import { prisma } from "@/lib/prisma";

const DEAD_LINK = "This reset link has expired or was already used. Request a new one.";

/**
 * POST { token, password } -> sets the password from an emailed reset link.
 * Signs out every session and revokes MCP tokens, same as an exec reset,
 * then returns the account kind so the page can point at the right sign-in.
 */
export async function POST(request: NextRequest) {
  const invalid = passwordRequestError(request);
  if (invalid) return invalid;

  const body = await jsonBody(request);
  const token = body?.token;
  if (typeof token !== "string" || !token.startsWith("rst_")) {
    return NextResponse.json({ error: DEAD_LINK }, { status: 400 });
  }
  const badPassword = passwordProblem(body?.password);
  if (badPassword) return NextResponse.json({ error: badPassword }, { status: 400 });

  // Look the link up before the deliberately slow scrypt, so junk tokens cost nothing.
  const hash = hashInvite(token);
  const link = await prisma.verificationToken.findUnique({ where: { token: hash } });
  if (!link || link.expires <= new Date()) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

  const passwordHash = hashPassword(body?.password as string);
  const accountKind = await prisma.$transaction(async (tx) => {
    // Same per-email lock as login and exec issuance.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${link.identifier}))`;
    // Spending the link is deleting it; a second concurrent use deletes nothing.
    const spent = await tx.verificationToken.deleteMany({ where: { token: hash, expires: { gt: new Date() } } });
    const user = spent.count ? await tx.user.findUnique({ where: { email: link.identifier }, select: { id: true, accountKind: true } }) : null;
    if (!user) return null;
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.mcpToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.verificationToken.deleteMany({ where: { identifier: link.identifier } });
    return user.accountKind;
  });
  if (!accountKind) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

  return NextResponse.json({ ok: true, accountKind }, { headers: { "Cache-Control": "no-store" } });
}
