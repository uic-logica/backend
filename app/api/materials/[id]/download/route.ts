import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

/** Public materials: anyone. Internal: board+ only. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await prisma.eventMaterial.findUnique({ where: { id } });
  if (!material) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (material.visibility === "INTERNAL") {
    const session = await auth();
    const board = Boolean(session?.user && session.user.accountKind === "MEMBER" && hasRole(session.user.role, "BOARD"));
    if (!board) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  return new NextResponse(new Uint8Array(material.data), {
    headers: {
      "Content-Type": material.mimeType,
      "Content-Disposition": `attachment; filename="${material.filename}"`,
    },
  });
}
