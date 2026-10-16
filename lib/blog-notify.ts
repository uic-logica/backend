import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

/**
 * A post went to review: every exec hears about it, by default in their 9 AM
 * summary rather than an email per post ("Applicant and blog updates").
 */
export async function submitBlogPost(title: string, author: string | null | undefined, postId?: string): Promise<void> {
  const execs = await prisma.user.findMany({ where: { accountKind: "MEMBER", role: "EXEC_BOARD" }, select: { id: true } });
  if (!execs.length) return;
  const message = `${author ?? "A member"} sent a blog post for review: "${title}"`;
  const link = `/dashboard/blog?view=review${postId ? `&id=${postId}` : ""}`;
  await Promise.all(execs.map(({ id }) => notifyUser(id, message, "boardUpdates", "A blog post to review", undefined, link)));
}
