import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

/** Self, or board+ (reviewing who's signed up) — streams the resume file. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { userId } = await params;
  const isSelf = session.user.id === userId;
  const isBoard = session.user.accountKind === "MEMBER" && hasRole(session.user.role, "BOARD");
  if (!isSelf && !isBoard) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { resumeData: true, resumeMimeType: true, resumeFilename: true },
  });
  if (!user?.resumeData) return NextResponse.json({ error: "No resume on file." }, { status: 404 });

  return new NextResponse(new Uint8Array(user.resumeData), {
    headers: {
      "Content-Type": user.resumeMimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${user.resumeFilename ?? "resume"}"`,
    },
  });
}
