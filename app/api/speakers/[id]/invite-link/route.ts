import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { mintInvite } from "@/lib/invite";
import { prisma } from "@/lib/prisma";

/**
 * Board+ only — a fresh link for a guest who already exists: the first one
 * expired, went to the wrong address, or was never sent.
 *
 * Minting a new one invalidates the old: there is one hash per submission,
 * so the previous secret stops matching the moment this writes. That is the
 * behaviour you want from a "resend" button — the link you just replaced
 * should not still work.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) {
    return NextResponse.json({ error: "Only the exec board can send guest links for now." }, { status: 403 });
  }

  const { id } = await params;
  const submission = await prisma.speakerSubmission.findUnique({
    where: { id },
    select: { id: true, user: { select: { id: true } } },
  });
  if (!submission) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (submission.user) {
    return NextResponse.json(
      { error: "They already have an account — a new link would have nothing to do." },
      { status: 409 },
    );
  }

  const { secret, ...invite } = mintInvite();
  await prisma.speakerSubmission.update({ where: { id }, data: invite });

  return NextResponse.json({ inviteToken: secret, expiresAt: invite.inviteExpiresAt }, { status: 201 });
}
