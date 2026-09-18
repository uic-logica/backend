import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseUpload } from "@/lib/upload";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — a resume PDF, not a portfolio

/** Any signed-in user (MEMBER or SPEAKER) — upload/replace your own resume. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseUpload(payload, MAX_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      resumeFilename: parsed.upload.filename,
      resumeMimeType: parsed.upload.mimeType,
      resumeData: parsed.upload.data,
    },
  });
  return NextResponse.json({ ok: true, filename: parsed.upload.filename });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { resumeFilename: null, resumeMimeType: null, resumeData: null },
  });
  return NextResponse.json({ ok: true });
}
