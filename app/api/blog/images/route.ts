import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseUpload } from "@/lib/upload";

// 3 MB: the most a base64 body fits under Vercel's 4.5 MB request cap.
const MAX_BYTES = 3 * 1024 * 1024;
// logica-lean: a flat per-member cap, no cleanup of pictures dropped from a draft — revisit if storage grows.
const MAX_PER_AUTHOR = 100;

/** A member adds a picture to a post: `{ filename, mimeType, data }` (base64). Returns its URL for the body. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.user.accountKind !== "MEMBER") {
    return NextResponse.json({ error: "Only members can write blog posts." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const parsed = parseUpload(payload, MAX_BYTES, ["png", "jpeg", "webp", "gif"]);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if ((await prisma.blogImage.count({ where: { authorId: session.user.id } })) >= MAX_PER_AUTHOR) {
    return NextResponse.json({ error: `You've reached ${MAX_PER_AUTHOR} pictures. Ask the exec board to clear old ones.` }, { status: 429 });
  }
  const image = await prisma.blogImage.create({
    data: { authorId: session.user.id, mimeType: parsed.upload.mimeType, data: parsed.upload.data },
    select: { id: true },
  });
  return NextResponse.json({ id: image.id, url: `/api/blog/images/${image.id}` }, { status: 201 });
}
