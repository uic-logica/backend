import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const STATUSES = ["PENDING", "CONFIRMED", "DECLINED"] as const;

/**
 * Public, no auth — fetch a draft's current state to pre-fill the completion
 * form. `note` is board-internal and deliberately left out: anyone holding
 * this link can call this endpoint, not just board members.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submission = await prisma.speakerSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      organization: true,
      referredBy: true,
      availability: true,
      needs: true,
      publicOptIn: true,
      status: true,
      submittedAt: true,
      createdAt: true,
    },
  });
  if (!submission) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(submission);
}

/** Board+ only — confirm or decline a speaker submission. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasRole(session.user.role, "BOARD")) {
    return NextResponse.json({ error: "Only board members can update speaker submissions." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { status } = (payload ?? {}) as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: `\`status\` must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.speakerSubmission.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const updated = await prisma.speakerSubmission.update({
    where: { id },
    data: { status: status as (typeof STATUSES)[number] },
  });
  return NextResponse.json(updated);
}
