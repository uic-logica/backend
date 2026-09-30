import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseApplication } from "@/lib/membership-application";
import { prisma } from "@/lib/prisma";

/**
 * The applicant answers a NEEDS_INFO request: same fields and rules as the
 * original application (email and track stay fixed), then back to PENDING.
 * reviewNote stays so the board sees what they asked for.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.membershipApplication.findUnique({
    where: { id },
    select: { id: true, userId: true, email: true, track: true, status: true },
  });
  const email = session.user.email?.toLowerCase();
  const owns = existing && (existing.userId === session.user.id || (!!email && existing.email === email));
  if (!existing || !owns) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (existing.status !== "NEEDS_INFO") {
    return NextResponse.json({ error: "This application isn't waiting on changes from you." }, { status: 409 });
  }

  const parsed = parseApplication({ ...(payload ?? {}) as object, email: existing.email, track: existing.track });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.data.track === "SOFTWARE_ENGINEER" && !parsed.data.resumeUrl) {
    const onFile = await prisma.user.findFirst({ where: { id: session.user.id, resumeData: { not: null } }, select: { id: true } });
    if (!onFile) {
      return NextResponse.json({ error: "Add a resume: upload a PDF on your profile or paste a link." }, { status: 400 });
    }
  }

  // email and track were pinned to the stored values above, so this can't move the row.
  const updated = await prisma.membershipApplication.update({
    where: { id },
    data: { ...parsed.data, status: "PENDING" },
  });
  return NextResponse.json(updated);
}
