import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { parseSpeakerFields } from "@/lib/speaker-submission";

/**
 * Board+ only — pre-fill whatever's already known about a speaker (name,
 * email, org, who referred them...) and get back an `id` to build a private
 * link (`/speak/:id` on the frontend). The speaker fills in the rest via
 * POST /api/speakers/:id/complete. Every field is optional here — that's
 * the whole point, fill in what you know.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!hasRole(session.user.role, "BOARD")) {
    return NextResponse.json({ error: "Only board members can create speaker drafts." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseSpeakerFields(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const draft = await prisma.speakerSubmission.create({ data: parsed.data });
  return NextResponse.json(draft, { status: 201 });
}
