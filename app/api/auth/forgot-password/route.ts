import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { jsonBody } from "@/lib/board-guard";
import { renderEmail } from "@/lib/email-layout";
import { hashInvite, normalizeEmail } from "@/lib/invite";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { sendMail } from "@/lib/mailer";
import { passwordRequestError } from "@/lib/password-request";
import { prisma } from "@/lib/prisma";
import { clientKey, overAttemptLimit } from "@/lib/rate-limit";

const LIFETIME_MS = 60 * 60 * 1000;

/**
 * POST { email } -> emails a one-hour, single-use link to /reset-password.
 * Spent by POST /api/auth/reset-password. Any account kind with an email.
 *
 * The answer is the same whether or not the address has an account. Signup
 * already admits that (see its comment), so this isn't hiding much — but it
 * costs nothing here.
 */
export async function POST(request: NextRequest) {
  const invalid = passwordRequestError(request);
  if (invalid) return invalid;

  const body = await jsonBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter the email you signed up with." }, { status: 400 });

  // Per address so nobody's inbox gets flooded; per client so one caller can't walk a list.
  if (overAttemptLimit(`reset:${email}`, 3, LIFETIME_MS) || overAttemptLimit(`reset-ip:${clientKey(request)}`, 20, LIFETIME_MS)) {
    return NextResponse.json({ error: "Too many reset requests. Try again in an hour." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    // Same 256-bit, hash-only shape as invite links: the link is a credential.
    const secret = `rst_${randomBytes(32).toString("base64url")}`;
    // Newest link wins; older ones (and expired leftovers) go.
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier: email } }),
      prisma.verificationToken.create({
        data: { identifier: email, token: hashInvite(secret), expires: new Date(Date.now() + LIFETIME_MS) },
      }),
    ]);
    // In the fragment, not the query: never sent to a server, so it stays out of request logs.
    const url = `${frontendOrigin()}/reset-password#token=${secret}`;
    try {
      await sendMail({
        to: email,
        subject: "Reset your LOGICA password",
        ...renderEmail({
          preheader: "This link works once and expires in an hour.",
          heading: "Reset your password",
          paragraphs: ["Someone asked to reset the password for this LOGICA @ UIC account. If that was you, choose a new one:"],
          button: { label: "Choose a new password", url },
          footnote: "This link works once and expires in an hour. If you didn't ask for this, ignore this email; your password hasn't changed.",
        }),
      });
    } catch (err) {
      // Already in the email log; the caller still gets the generic answer.
      console.error("password reset email failed", err);
    }
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
