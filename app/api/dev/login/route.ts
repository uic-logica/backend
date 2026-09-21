import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { attachSpeakerSession } from "@/lib/session";

/**
 * Dev-only view switcher: `GET /api/dev/login?as=<role>` provisions a fake
 * account and signs it in, then bounces to /dashboard. One per stage, so
 * all five dashboards can be compared in a few clicks.
 *
 * Exists because the two real sign-in paths are both slow to drive by hand
 * during UI work — MEMBER needs an emailed OTP, SPEAKER needs a password —
 * and neither lets you flip between the three dashboard views in a click.
 * 404s outside development, so it can't ship.
 */
const accounts = {
  member: { id: "qa-member", email: "qa.member@uic.edu", name: "QA Member", role: "MEMBER" },
  board: { id: "qa-board", email: "qa.board@uic.edu", name: "QA Board", role: "BOARD" },
  exec: { id: "qa-exec", email: "qa.exec@uic.edu", name: "QA Exec Board", role: "EXEC_BOARD" },
  // Candidate and speaker are the same account either side of the board's
  // decision, so the switcher sets the submission status to match.
  candidate: { id: "qa-speaker", email: "qa.speaker@example.com", name: "QA Guest Speaker", status: "PENDING" },
  speaker: { id: "qa-speaker", email: "qa.speaker@example.com", name: "QA Guest Speaker", status: "CONFIRMED" },
} as const;

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const as = (request.nextUrl.searchParams.get("as") ?? "member") as keyof typeof accounts;
  if (!Object.hasOwn(accounts, as)) {
    return NextResponse.json(
      { error: `Unknown view. Use one of: ${Object.keys(accounts).join(", ")}.` },
      { status: 400 },
    );
  }

  if (as === "speaker" || as === "candidate") {
    const { id, email, name, status } = accounts[as];
    await prisma.speakerSubmission.upsert({
      where: { id: "qa-speaker-submission" },
      create: {
        id: "qa-speaker-submission",
        name,
        email,
        organization: "Example Labs (Test)",
        status,
        submittedAt: new Date(),
        publicOptIn: false,
        needs: "Projector and HDMI cable",
        note: "Fictional account for dashboard testing.",
      },
      update: { status },
    });
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email,
        name,
        accountKind: "SPEAKER",
        username: "qa-speaker",
        // Same password the speaker sign-in form accepts, so this account is
        // reachable without this route too.
        passwordHash: hashPassword("Logica-QA-2026!"),
        mustChangePassword: false,
        speakerSubmissionId: "qa-speaker-submission",
      },
      update: { mustChangePassword: false },
    });
  } else {
    const { id, email, name, role } = accounts[as];
    await prisma.user.upsert({
      where: { id },
      create: { id, email, name, role, emailVerified: new Date() },
      update: { role },
    });
  }

  // These are noisy fakes — don't let them queue real reminder mail.
  await prisma.emailPreference.upsert({
    where: { userId: accounts[as].id },
    create: { userId: accounts[as].id, eventReminders: false, announcements: false },
    update: {},
  });

  // The browser talks to the frontend (:3002), which rewrites /api/* here, so
  // `request.url` is the backend's own origin — the forwarded host is the one
  // the cookie and the redirect actually belong to.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const response = NextResponse.redirect(`${proto}://${host}/dashboard`);
  await attachSpeakerSession(accounts[as].id, request, response);
  return response;
}
