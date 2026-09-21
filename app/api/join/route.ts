import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { parseApplication } from "@/lib/membership-application";
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
  return NextResponse.json(applications);
}

/**
 * Public, no sign-in: submits a membership application from /join.
 *
 * logica-lean: limited per email, in memory, and one open application per
 * email and track. That doesn't stop someone cycling through made-up UIC
 * addresses. Revisit with a per-IP limit if junk applications show up.
 */
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseApplication(payload);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { email, track } = parsed.data;

  if (overAttemptLimit(`join:${email}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const open = await prisma.membershipApplication.findFirst({
    where: { email, track, status: { in: ["PENDING", "INTERVIEW"] } },
    select: { id: true },
  });
  if (open) {
    return NextResponse.json({ error: "You already have an application in for this track." }, { status: 409 });
  }

  const application = await prisma.membershipApplication.create({ data: parsed.data });
  return NextResponse.json({ id: application.id }, { status: 201 });
}
