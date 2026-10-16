import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { clip } from "@/lib/agent-activity";
import { prisma } from "@/lib/prisma";

/** Any signed-in person: what their own agents did, newest first. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const rows = await prisma.agentActivity.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, summary: true, tool: true, via: true, createdAt: true },
  });
  return NextResponse.json(rows);
}

/**
 * An agent working through someone's signed-in dashboard (not MCP) notes
 * what it did, so it shows up in that person's log like an MCP change.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { summary, via } = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const text = typeof summary === "string" ? summary.trim() : "";
  if (!text || text.length > 300) return NextResponse.json({ error: "`summary` is one sentence, up to 300 characters." }, { status: 400 });
  // Written directly, not through logActivity: here the log line is the whole request, so a failure should say so.
  await prisma.agentActivity.create({
    data: { userId: session.user.id, summary: text, via: typeof via === "string" && via.trim() ? clip(via, 60) : null },
  });
  return NextResponse.json({ logged: true }, { status: 201 });
}
