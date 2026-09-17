import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const DEFAULTS = { eventReminders: true, announcements: true };

/** Any signed-in user — which categories of email they want. Defaults on until they say otherwise. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const pref = await prisma.emailPreference.findUnique({ where: { userId: session.user.id } });
  return NextResponse.json(pref ?? DEFAULTS);
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

  const { eventReminders, announcements } = (payload ?? {}) as Record<string, unknown>;
  if (eventReminders !== undefined && typeof eventReminders !== "boolean") {
    return NextResponse.json({ error: "`eventReminders` must be a boolean." }, { status: 400 });
  }
  if (announcements !== undefined && typeof announcements !== "boolean") {
    return NextResponse.json({ error: "`announcements` must be a boolean." }, { status: 400 });
  }

  const pref = await prisma.emailPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...DEFAULTS, ...(eventReminders !== undefined && { eventReminders }), ...(announcements !== undefined && { announcements }) },
    update: { ...(eventReminders !== undefined && { eventReminders }), ...(announcements !== undefined && { announcements }) },
  });
  return NextResponse.json(pref);
}
