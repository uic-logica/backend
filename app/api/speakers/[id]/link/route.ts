import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsWorkspace } from "@/lib/authz";
import { linkGuests, separateGuest } from "@/lib/speaker-thread";

type Params = { params: Promise<{ id: string }> };

async function exec() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!runsWorkspace(session.user)) return NextResponse.json({ error: "Only the exec board can link guests." }, { status: 403 });
  return null;
}

/**
 * Exec only. `{ withId }` links that guest into this guest's thread: one
 * thread, one event, both of them in it. Its existing messages move over.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await exec();
  if (denied) return denied;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const { withId } = (payload ?? {}) as { withId?: unknown };
  if (typeof withId !== "string" || !withId) return NextResponse.json({ error: "`withId` is required." }, { status: 400 });
  const result = await linkGuests((await params).id, withId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}

/** Exec only: this guest leaves the shared thread (on the lead, everyone separates). Messages stay where they are. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await exec();
  if (denied) return denied;
  const separated = await separateGuest((await params).id);
  return NextResponse.json({ separated });
}
