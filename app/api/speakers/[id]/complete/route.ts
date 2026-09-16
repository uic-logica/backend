import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { overAttemptLimit } from "@/lib/rate-limit";
import { parseCompletion } from "@/lib/speaker-submission";

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Public, no auth — the speaker finishing a draft a board member started.
 * Fills in whatever the draft didn't already have and locks it in.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (overAttemptLimit(`speaker-complete:${clientKey(request)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { id } = await params;
  const existing = await prisma.speakerSubmission.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (existing.submittedAt) {
    return NextResponse.json({ error: "This has already been submitted." }, { status: 409 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseCompletion(payload, existing.name, existing.email);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await prisma.speakerSubmission.update({
    where: { id },
    data: { ...parsed.data, submittedAt: new Date() },
  });
  return NextResponse.json({ id: updated.id }, { status: 200 });
}
