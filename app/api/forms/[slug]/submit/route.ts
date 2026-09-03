import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { data } = (payload ?? {}) as { data?: unknown };
  if (typeof data !== "object" || data === null) {
    return NextResponse.json({ error: "`data` must be an object." }, { status: 400 });
  }

  const { slug } = await params;
  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  const submission = await prisma.submission.create({
    data: { formId: form.id, userId: session.user.id, data: data as object },
  });
  return NextResponse.json(submission, { status: 201 });
}
