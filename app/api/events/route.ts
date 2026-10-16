import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount } from "@/lib/authz";
import { EventInputError, parseStartsAt } from "@/lib/event-update";
import { parseHttpLink } from "@/lib/link";
import { prisma } from "@/lib/prisma";

// logica-lean: bare-minimum Event CRUD for #7 (BE 5). No editing — real
// ticket designs that.

/** Public, no auth — events are marketing content, not member-only. */
export async function GET() {
  const events = await prisma.event.findMany({ orderBy: { startsAt: "asc" }, take: 50 });
  return NextResponse.json(events);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isBoardAccount(session.user)) {
    return NextResponse.json({ error: "Only board members can create events." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { title, description, location, startsAt, link } = (payload ?? {}) as Record<string, unknown>;
  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "`title` is required." }, { status: 400 });
  }
  // Missing, null or "TBD" means the date isn't set yet.
  let start: Date | null;
  try {
    start = startsAt === undefined ? null : parseStartsAt(startsAt);
  } catch (error) {
    if (error instanceof EventInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const eventLink = typeof link === "string" ? link.trim() : link == null ? "" : null;
  if (eventLink === null || (eventLink && !parseHttpLink(eventLink).ok)) {
    return NextResponse.json({ error: "`link` must be an http or https URL." }, { status: 400 });
  }

  const event = await prisma.event.create({
    data: {
      title: title.trim(),
      description: typeof description === "string" ? description : null,
      location: typeof location === "string" ? location : null,
      link: eventLink || null,
      startsAt: start,
    },
  });
  return NextResponse.json(event, { status: 201 });
}

