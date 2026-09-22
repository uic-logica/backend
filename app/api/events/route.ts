import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
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
  if (session.user.role !== "BOARD" && session.user.role !== "EXEC_BOARD") {
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
  if (typeof startsAt !== "string" || Number.isNaN(Date.parse(startsAt))) {
    return NextResponse.json({ error: "`startsAt` must be an ISO date string." }, { status: 400 });
  }
  const eventLink = typeof link === "string" ? link.trim() : link == null ? "" : null;
  if (eventLink === null || (eventLink && !isHttpUrl(eventLink))) {
    return NextResponse.json({ error: "`link` must be an http or https URL." }, { status: 400 });
  }

  const event = await prisma.event.create({
    data: {
      title: title.trim(),
      description: typeof description === "string" ? description : null,
      location: typeof location === "string" ? location : null,
      link: eventLink || null,
      startsAt: new Date(startsAt),
    },
  });
  return NextResponse.json(event, { status: 201 });
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
