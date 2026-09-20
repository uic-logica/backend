import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { INVOLVEMENT_COUNTS, withInvolvement } from "@/lib/involvement";

/** Private engagement and RSVP history. Always scoped to the authenticated user. */
export async function GET() {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      _count: INVOLVEMENT_COUNTS,
      rsvps: { select: { eventId: true, status: true } },
      attendances: {
        orderBy: { checkedInAt: "desc" },
        take: 20,
        select: {
          id: true,
          checkedInAt: true,
          event: { select: { title: true } },
        },
      },
      posts: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, body: true, createdAt: true },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          form: { select: { title: true } },
        },
      },
    },
  });
  if (!user)
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json(withInvolvement(user));
}
