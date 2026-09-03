import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// logica-lean: bare-minimum self profile read/update for #7 (BE 3). No
// involvement summary yet — real ticket adds that once attendance/feed data
// exists to summarize.
const SELF_FIELDS = { id: true, name: true, email: true, role: true, bio: true, major: true, gradYear: true } as const;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: SELF_FIELDS });
  return NextResponse.json(user);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { name, bio, major, gradYear } = (payload ?? {}) as Record<string, unknown>;
  if (name !== undefined && typeof name !== "string") {
    return NextResponse.json({ error: "`name` must be a string." }, { status: 400 });
  }
  if (bio !== undefined && typeof bio !== "string") {
    return NextResponse.json({ error: "`bio` must be a string." }, { status: 400 });
  }
  if (major !== undefined && typeof major !== "string") {
    return NextResponse.json({ error: "`major` must be a string." }, { status: 400 });
  }
  if (gradYear !== undefined && typeof gradYear !== "number") {
    return NextResponse.json({ error: "`gradYear` must be a number." }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { name, bio, major, gradYear },
    select: SELF_FIELDS,
  });
  return NextResponse.json(user);
}
