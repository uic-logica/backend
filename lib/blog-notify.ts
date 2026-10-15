import { prisma } from "@/lib/prisma";

/**
 * A post went to review: a dashboard notification for every exec, no email
 * (one email per submitted post would be noise).
 */
export async function submitBlogPost(title: string, author: string | null | undefined): Promise<void> {
  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
  if (!execs.length) return;
  await prisma.notification.createMany({
    data: execs.map(({ id }) => ({ userId: id, message: `${author ?? "A member"} sent a blog post for review: "${title}"` })),
  });
}
