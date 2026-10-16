import { prisma } from "@/lib/prisma";

/** A quote short enough to read in a list. */
export const clip = (text: unknown, max = 80) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Record what someone's agent did. Never throws: a missed log line must not
 * turn a change that already happened into an error the agent retries.
 */
export async function logActivity(userId: string, summary: string, tool: string | null = null, via: string | null = null) {
  try {
    await prisma.agentActivity.create({ data: { userId, summary: clip(summary, 300), tool, via: via && clip(via, 60) } });
  } catch (error) {
    console.error("agent activity log failed", error);
  }
}
