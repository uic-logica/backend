import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Not signed in.", { status: 401 });
  const { userId } = await params;
  const photo = await prisma.user.findUnique({
    where: { id: userId },
    select: { photoData: true, photoMimeType: true },
  });
  if (!photo?.photoData || !photo.photoMimeType) return new Response("Not found.", { status: 404 });
  return new Response(photo.photoData, {
    headers: {
      "Content-Type": photo.photoMimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
