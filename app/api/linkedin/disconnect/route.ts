import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await prisma.user.update({
    where: { id: session.user.id },
    data: { linkedinSub: null, photoUrl: null, photoData: null, photoMimeType: null },
  });
  return NextResponse.json({ ok: true });
}
