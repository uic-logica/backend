import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/authz";
import { notifyEventGoing } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { parseUpload } from "@/lib/upload";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — a slide deck

async function isBoard(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user && session.user.accountKind === "MEMBER" && hasRole(session.user.role, "BOARD"));
}

/** Public materials are visible to anyone, signed in or not; internal ones need board+. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const board = await isBoard();

  const materials = await prisma.eventMaterial.findMany({
    where: { eventId: id, ...(board ? {} : { visibility: "PUBLIC" }) },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, mimeType: true, visibility: true, createdAt: true },
  });
  return NextResponse.json(materials);
}

/** Board+ only — upload slides/notes for this event. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "MEMBER" || !hasRole(session.user.role, "BOARD")) {
    return NextResponse.json({ error: "Only board members can upload event materials." }, { status: 403 });
  }

  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseUpload(payload, MAX_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { visibility } = (payload ?? {}) as { visibility?: unknown };
  const materialVisibility = visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL";

  const material = await prisma.eventMaterial.create({
    data: {
      eventId: id,
      uploadedById: session.user.id,
      filename: parsed.upload.filename,
      mimeType: parsed.upload.mimeType,
      data: parsed.upload.data,
      visibility: materialVisibility,
    },
    select: { id: true, filename: true, mimeType: true, visibility: true, createdAt: true },
  });

  if (materialVisibility === "PUBLIC") {
    await notifyEventGoing(id, `New material posted for ${event.title}: ${material.filename}`, "eventReminders");
  }

  return NextResponse.json(material, { status: 201 });
}
