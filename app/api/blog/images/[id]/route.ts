import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public, no auth: a blog picture by id, so /blog can show it. Ids are
 * unguessable cuids; a picture in an unpublished draft is reachable only by
 * whoever has its link. Never changes once uploaded, so cache it for a year.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const image = await prisma.blogImage.findUnique({ where: { id }, select: { mimeType: true, data: true } });
  if (!image) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(Buffer.from(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
