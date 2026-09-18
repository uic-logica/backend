import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { STATUSES, isStatus } from "@/lib/membership-application";
import { prisma } from "@/lib/prisma";

/** Board only: moves an application to PENDING, INTERVIEW, ACCEPTED or DECLINED. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasRole(session.user.role, "BOARD")) {
    return NextResponse.json({ error: "Only board members can update applications." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { status } = (payload ?? {}) as { status?: unknown };
  if (!isStatus(status)) {
    return NextResponse.json({ error: `\`status\` must be one of: ${STATUSES.join(", ")}.` }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.membershipApplication.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const updated = await prisma.membershipApplication.update({ where: { id }, data: { status } });
  return NextResponse.json(updated);
}
