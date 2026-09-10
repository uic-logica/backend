import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { INVOLVEMENT_COUNTS, withInvolvement } from "@/lib/involvement";

// This section is for someone else's profile.  
const PUBLIC_FIELDS = { id: true, name: true, role: true, major: true, gradYear: true, image: true } as const;
 
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 }); 
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { ...PUBLIC_FIELDS, _count: INVOLVEMENT_COUNTS }, // Added: counts for involvement summary
  });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(withInvolvement(user)); // Added: transform counts to involvement block
}