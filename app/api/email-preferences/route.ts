import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { type Mode, categoriesFor, modeFor, modesFor } from "@/lib/email-prefs";
import { prisma } from "@/lib/prisma";

type Session = { id: string; role?: string | null; accountKind?: string | null };

/** What Settings shows: this person's categories, how each one emails now, and their choices. */
function view(user: Session, saved: unknown) {
  return {
    modes: modesFor(user),
    categories: categoriesFor(user).map((c) => ({ key: c.key, label: c.label, description: c.description, mode: modeFor(user, saved, c.key) })),
  };
}

/** Any signed-in user: how they get each kind of email. Decisions always email and aren't listed. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const pref = await prisma.emailPreference.findUnique({ where: { userId: session.user.id } });
  return NextResponse.json(view(session.user, pref?.modes));
}

/** `{ category, mode }`: one category at a time, only the categories and modes this person has. */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { category, mode } = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!categoriesFor(session.user).some((c) => c.key === category)) {
    return NextResponse.json({ error: "Unknown email category." }, { status: 400 });
  }
  if (!modesFor(session.user).includes(mode as Mode)) {
    return NextResponse.json({ error: `\`mode\` must be one of ${modesFor(session.user).join(", ")}.` }, { status: 400 });
  }

  const current = await prisma.emailPreference.findUnique({ where: { userId: session.user.id } });
  const modes = { ...((current?.modes as Record<string, Mode> | undefined) ?? {}), [category as string]: mode as Mode };
  await prisma.emailPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, modes },
    update: { modes },
  });
  return NextResponse.json(view(session.user, modes));
}
