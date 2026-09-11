import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { INVOLVEMENT_COUNTS, withInvolvement } from "@/lib/involvement";

const SELF_FIELDS = { id: true, name: true, email: true, image: true, role: true, bio: true, major: true, gradYear: true } as const;

function isGradYear(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2100;
}

function trimmed(value: unknown): string | null | undefined {
  if (typeof value !== "string") return value as null | undefined;
  return value.trim() || null;
}

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
  if (name !== undefined && name !== null && typeof name !== "string") {
    return NextResponse.json({ error: "`name` must be a string or null." }, { status: 400 });
  }
  if (bio !== undefined && bio !== null && typeof bio !== "string") {
    return NextResponse.json({ error: "`bio` must be a string or null." }, { status: 400 });
  }
  if (major !== undefined && major !== null && typeof major !== "string") {
    return NextResponse.json({ error: "`major` must be a string or null." }, { status: 400 });
  }
  if (gradYear !== undefined && gradYear !== null && !isGradYear(gradYear)) {
    return NextResponse.json({ error: "`gradYear` must be a four-digit year." }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: trimmed(name),
      bio: trimmed(bio),
      major: trimmed(major),
      gradYear: gradYear as number | null | undefined,
    },
    select: { ...SELF_FIELDS, _count: INVOLVEMENT_COUNTS },
  });
  return NextResponse.json(withInvolvement(user));
}