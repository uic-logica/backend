import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// logica-lean: bare-minimum generic Form for #7 (BE 7) — one field type
// (free-text `type`, no validation schema), no versioning.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { slug } = await params;
  const form = await prisma.form.findUnique({ where: { slug }, include: { fields: true } });
  if (!form) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(form);
}
