import { NextRequest, NextResponse } from "next/server";
import { INVITE_PROBLEM, lookupInvite } from "@/lib/invite";
import { clientKey, overAttemptLimit } from "@/lib/rate-limit";

/**
 * Public — what the claim page shows before anyone types anything: who the
 * board thinks this is, and what they're being asked to come and do.
 *
 * POST rather than GET with the token in the path, so the secret never ends
 * up in an access log, a Referer header, or a browser history sync.
 */
export async function POST(request: NextRequest) {
  // The token is unguessable, but nothing should be free to grind at it.
  if (overAttemptLimit(`invite-lookup:${clientKey(request)}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const result = await lookupInvite((payload as Record<string, unknown>)?.token);
  if (!result.ok) {
    return NextResponse.json(
      { error: INVITE_PROBLEM[result.reason], reason: result.reason },
      { status: result.reason === "unknown" ? 404 : 410 },
    );
  }

  const { submission } = result;
  return NextResponse.json({
    name: submission.name,
    email: submission.email,
    organization: submission.organization,
    kind: submission.kind,
  });
}
