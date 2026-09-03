import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const attendances = await prisma.attendance.findMany({
    where: { userId: session.user.id },
    orderBy: { checkedInAt: "desc" },
    include: { event: { select: { id: true, title: true, startsAt: true } } },
  });
  return NextResponse.json(attendances);
}
