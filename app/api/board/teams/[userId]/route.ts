import { NextRequest, NextResponse } from "next/server";
import { jsonBody, requireBoard } from "@/lib/board-guard";
import { isTeam, placeOnTeam } from "@/lib/teams";

/** Put a member on a team, move them, or take them off (`team: null`). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const body = await jsonBody(request);
  if (!body || !(body.team === null || isTeam(body.team))) {
    return NextResponse.json({ error: "`team` must be a team or null." }, { status: 400 });
  }
  const { userId } = await params;
  const updated = await placeOnTeam(userId, body.team);
  if (!updated) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(updated);
}
