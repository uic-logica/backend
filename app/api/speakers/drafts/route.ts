import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { isVisitKind, mintInvite } from "@/lib/invite";
import { prisma } from "@/lib/prisma";
import { parseSpeakerFields } from "@/lib/speaker-submission";

/**
 * Board+ only — start a guest: fill in whatever's already known (name,
 * email, org, who referred them, whether it's a talk or a workshop) and get
 * back a single-use link to send them.
 *
 * The link is the whole flow. They click it, pick an email and a password,
 * and they're in their own dashboard — no second step for the board, no
 * emailed temp password. `inviteToken` comes back exactly once; only its
 * hash is stored, so a lost link is regenerated, never recovered.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can create guest drafts." }, { status: 403 });
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

  const kind = (payload as Record<string, unknown>)?.kind;
  if (kind !== undefined && !isVisitKind(kind)) {
    return NextResponse.json(
      { error: "`kind` must be TALK, WORKSHOP or COMPANY_VISIT." },
      { status: 400 },
    );
  }

  const { secret, ...invite } = mintInvite();
  const draft = await prisma.speakerSubmission.create({
    data: { ...parsed.data, ...(kind ? { kind } : {}), ...invite },
  });

  return NextResponse.json(
    { ...draft, inviteTokenHash: undefined, inviteToken: secret },
    { status: 201 },
  );
}
