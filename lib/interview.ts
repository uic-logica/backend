import { createHash, randomBytes } from "node:crypto";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { prisma } from "@/lib/prisma";

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
