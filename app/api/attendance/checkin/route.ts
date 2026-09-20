import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkCode } from "@/lib/check-in";
import { prisma } from "@/lib/prisma";
import { clearAttempts, overAttemptLimit } from "@/lib/rate-limit";

const ERRORS = {
  closed: "Check-in isn't open for this event.",
  expired: "Check-in for this event has closed.",
  wrong: "That check-in code isn't right.",
} as const;

/** Wrong codes allowed per member before they have to wait. */
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60_000;

/** Signed-in member checks themselves in with the code shown at the event. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { eventId, code } = (payload ?? {}) as { eventId?: unknown; code?: unknown };
  if (typeof eventId !== "string" || eventId.length === 0 || typeof code !== "string") {
    return NextResponse.json({ error: "`eventId` and `code` are required." }, { status: 400 });
  }

  const attemptKey = `check-in:${session.user.id}`;
  if (overAttemptLimit(attemptKey, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { checkInCode: { select: { code: true, expiresAt: true } } },
  });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const result = checkCode(event.checkInCode, code);
  if (result !== "ok") return NextResponse.json({ error: ERRORS[result] }, { status: 400 });

  clearAttempts(attemptKey);
  const attendance = await prisma.attendance.upsert({
    where: { eventId_userId: { eventId, userId: session.user.id } },
    create: { eventId, userId: session.user.id },
    update: {},
  });
  return NextResponse.json(attendance, { status: 201 });
}
