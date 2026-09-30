import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const applications = await prisma.membershipApplication.findMany({
    where: {
      OR: [
        { userId: session.user.id },
        ...(session.user.email ? [{ email: session.user.email.toLowerCase() }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      track: true,
      status: true,
      projects: true,
      hoursPerWeek: true,
      name: true,
      major: true,
      gradYear: true,
      why: true,
      github: true,
      skills: true,
      resumeUrl: true,
      reviewNote: true,
      canReapply: true,
      decidedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json(applications);
}
