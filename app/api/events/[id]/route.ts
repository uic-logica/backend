import { NextRequest, NextResponse } from "next/server";
import { partnerAuth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { EventInputError, parseEventUpdate } from "@/lib/event-update";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// logica-lean: the shareable/embed link ticket (#7, BE 5) wants a dedicated
// public shape; this just returns the raw record for now.
/** Public, no auth — same reasoning as the list: events are marketing content. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(event);
}

/**
 * Board+, or a partner club granted this event (EventAccess): change an event's title, time, location, description or link.
 * Only the fields sent change; an empty string clears location, description
 * or link. Same rules as the MCP `update_event` tool (lib/event-update.ts).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await partnerAuth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const partner =
    session.user.accountKind === "PARTNER" &&
    !!(await prisma.eventAccess.findUnique({ where: { userId_eventId: { userId: session.user.id, eventId: id } } }));
  if (!isBoardAccount(session.user) && !partner) {
    return NextResponse.json({ error: "Only board members can edit events." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { title, startsAt, location, description, link } = payload as Record<string, unknown>;
  let data;
  try {
    data = parseEventUpdate({ title, startsAt, location, description, link });
  } catch (error) {
    if (error instanceof EventInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }

  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  const event = await prisma.event.update({ where: { id }, data });
  return NextResponse.json(event);
}
