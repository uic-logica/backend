import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Public view — no bio/email leakage of private fields beyond what's meant to be public.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, major: true, gradYear: true, image: true },
  });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(user);
}
