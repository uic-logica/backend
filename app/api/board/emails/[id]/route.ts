import { NextRequest, NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { prisma } from "@/lib/prisma";

/** Exec only: one logged email with exactly what was sent (HTML and plain text). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const row = await prisma.emailLog.findUnique({ where: { id: (await params).id } });
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(row);
}
