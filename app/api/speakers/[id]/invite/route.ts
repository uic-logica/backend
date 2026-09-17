import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendMail } from "@/lib/mailer";
import { generateTempPassword, hashPassword, slugifyUsername } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { speakerInviteEmail } from "@/lib/speaker-email";

/**
 * EXEC_BOARD only — turns a confirmed speaker submission into a SPEAKER
 * account: generates a username + one-time temp password, emails it, and
 * links the account back to the submission. See AUTH.md.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "MEMBER" || session.user.role !== "EXEC_BOARD") {
    return NextResponse.json({ error: "Only exec board can invite a speaker to the portal." }, { status: 403 });
  }

  const { id } = await params;
  const submission = await prisma.speakerSubmission.findUnique({ where: { id }, include: { user: true } });
  if (!submission) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (submission.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Only confirmed speakers can be invited." }, { status: 409 });
  }
  if (submission.user) {
    return NextResponse.json({ error: "This speaker already has a portal account." }, { status: 409 });
  }
  if (!submission.email) {
    return NextResponse.json({ error: "This submission has no email on file." }, { status: 400 });
  }
  if (await prisma.user.findUnique({ where: { email: submission.email } })) {
    return NextResponse.json({ error: "That email already belongs to an account." }, { status: 409 });
  }

  const base = slugifyUsername(submission.name, submission.email);
  let username = base;
  for (let suffix = 2; await prisma.user.findUnique({ where: { username } }); suffix++) {
    username = `${base}-${suffix}`;
  }

  const tempPassword = generateTempPassword();
  const user = await prisma.user.create({
    data: {
      name: submission.name,
      email: submission.email,
      accountKind: "SPEAKER",
      username,
      passwordHash: hashPassword(tempPassword),
      mustChangePassword: true,
      speakerSubmissionId: submission.id,
    },
  });

  const { subject, text, html } = speakerInviteEmail(username, tempPassword);
  await sendMail({ to: submission.email, subject, text, html });

  // Temp password returned once as a fallback if the email doesn't land —
  // never stored or logged anywhere after this response.
  return NextResponse.json({ id: user.id, username, tempPassword }, { status: 201 });
}
