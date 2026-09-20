import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// logica-lean: the shareable/embed link ticket (#7, BE 5) wants a dedicated
// public shape; this just returns the raw record for now.
/** Public, no auth — same reasoning as the list: events are marketing content. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(event);
}
