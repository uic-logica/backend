import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateFormData } from "@/lib/request-limits";

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
  const validated = validateFormData(data);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const { slug } = await params;
  const form = await prisma.form.findUnique({ where: { slug } });
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });

  const submission = await prisma.submission.create({
    data: { formId: form.id, userId: session.user.id, data: validated.data as Prisma.InputJsonObject },
  });
  return NextResponse.json(submission, { status: 201 });
}
