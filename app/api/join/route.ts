import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { parseApplication, reapplyBlock } from "@/lib/membership-application";
import { prisma } from "@/lib/prisma";
import { overAttemptLimit } from "@/lib/rate-limit";

/** Board only: every application, newest first. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can see applications." }, { status: 403 });
  }

  const applications = await prisma.membershipApplication.findMany({ orderBy: { createdAt: "desc" } });
  // Flag the applicants with a PDF on their profile; the board downloads it from /api/resume/:userId.
  const userIds = applications.flatMap((a) => (a.userId ? [a.userId] : []));
  const withResume = new Set(
    userIds.length
      ? (await prisma.user.findMany({ where: { id: { in: userIds }, resumeData: { not: null } }, select: { id: true } })).map((u) => u.id)
      : [],
  );
  return NextResponse.json(applications.map((a) => ({ ...a, resumeOnFile: !!a.userId && withResume.has(a.userId) })));
}

/**
 * Submits an application from /join. Board applications are public; build
 * team applications use the signed-in member's UIC identity.
 *
 * logica-lean: limited per email, in memory, and one open application per
 * email and track (see reapplyBlock for the rules after a decision). That doesn't stop someone cycling through made-up UIC
 * addresses. Revisit with a per-IP limit if junk applications show up.
 */
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  let userId: string | undefined;
  if (body.track === "SOFTWARE_ENGINEER") {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in with your UIC account to apply to a build team." }, { status: 401 });
    }
    const sessionEmail = session.user.email;
    if (!sessionEmail?.toLowerCase().endsWith("@uic.edu")) {
      return NextResponse.json({ error: "Build team applications need a @uic.edu account." }, { status: 403 });
    }
    payload = { ...body, email: sessionEmail };
    userId = session.user.id;
  }

  const parsed = parseApplication(payload);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { email, track } = parsed.data;

  if (overAttemptLimit(`join:${email}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const past = await prisma.membershipApplication.findMany({
    where: { email, track },
    select: { status: true, canReapply: true, decidedAt: true, createdAt: true },
  });
  const blocked = reapplyBlock(past);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  if (userId && parsed.data.track === "SOFTWARE_ENGINEER" && !parsed.data.resumeUrl) {
    const onFile = await prisma.user.findFirst({ where: { id: userId, resumeData: { not: null } }, select: { id: true } });
    if (!onFile) {
      return NextResponse.json({ error: "Add a resume: upload a PDF on your profile or paste a link." }, { status: 400 });
    }
  }

  const application = await prisma.membershipApplication.create({
    data: userId ? { ...parsed.data, userId } : parsed.data,
  });
  return NextResponse.json({ id: application.id }, { status: 201 });
}
