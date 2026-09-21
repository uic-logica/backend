import { NextRequest, NextResponse } from "next/server";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { issueMemberPassword, normalizeMemberEmail } from "@/lib/member-password";
import { passwordRequestError } from "@/lib/password-request";

export async function POST(request: NextRequest) {
  const invalid = passwordRequestError(request);
  if (invalid) return invalid;
  const gate = await requireBoard("EXEC_BOARD");
  if (gate.error) return gate.error;
  const body = await jsonBody(request);
  const email = normalizeMemberEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid university email." }, { status: 400 });
  // Self-reset would invalidate the current dashboard session before delivery.
  if (email === gate.user.email?.toLowerCase()) {
    return NextResponse.json({ error: "Ask another exec or a server administrator to reset your password." }, { status: 400 });
  }
  try {
    return NextResponse.json(await issueMemberPassword(email), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_MEMBER") {
      return NextResponse.json({ error: "This address belongs to a guest account." }, { status: 409 });
    }
    throw error;
  }
}
