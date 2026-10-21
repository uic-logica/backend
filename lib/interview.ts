import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { tell } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { parseAvailability } from "@/lib/speaker-submission";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Mint the applicant's private interview link: a random token, only its
 * hash stored. A new one replaces the old (moving back to INTERVIEW again
 * sends a fresh link).
 */
export async function openInterview(applicationId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await prisma.membershipApplication.update({ where: { id: applicationId }, data: { interviewTokenHash: hash(token) } });
  return `${frontendOrigin()}/interview/${token}`;
}

/** The application behind a link, while it's still in INTERVIEW. */
export async function applicationForInterview(token: string) {
  if (!token || token.length > 100) return null;
  const app = await prisma.membershipApplication.findUnique({
    where: { interviewTokenHash: hash(token) },
    select: { id: true, name: true, track: true, status: true, interviewAvailability: true, interviewAvailabilityAt: true },
  });
  return app?.status === "INTERVIEW" ? app : null;
}

/**
 * Save the times an applicant can interview and tell the exec board. The
 * private link and the applicant's own dashboard both land here, so the
 * rules and the notice read the same either way.
 */
export async function saveInterviewTimes(app: { id: string; name: string }, payload: unknown) {
  const parsed = parseAvailability((payload as { availability?: unknown })?.availability);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.windows.length) return NextResponse.json({ error: "Pick at least one time that works." }, { status: 400 });
  if (parsed.windows.length > 60) return NextResponse.json({ error: "That's a lot of separate times. Try fewer, longer blocks." }, { status: 400 });

  const savedAt = new Date();
  await prisma.membershipApplication.update({
    where: { id: app.id },
    data: { interviewAvailability: parsed.windows, interviewAvailabilityAt: savedAt },
  });

  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
  const url = `${frontendOrigin()}/dashboard/applications?id=${app.id}`;
  await Promise.all(
    execs.map((e) =>
      tell({ userId: e.id }, `${app.name} shared their interview availability.`, `${app.name} shared interview times`, {
        eyebrow: "Applications",
        heading: `${app.name} shared their interview times`,
        paragraphs: ["Their times are on their application. Pick one and reach out to set up the interview."],
        button: { label: "Open the application", url },
      }, "boardUpdates"),
    ),
  );
  return NextResponse.json({ availability: parsed.windows, savedAt });
}
