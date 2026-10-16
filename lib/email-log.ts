import type { EmailStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The exec board's record of every email: sent, failed (with why) or
 * skipped (with why). Never throws: losing a log row must not stop an email.
 */
export async function logEmail(row: {
  to: string;
  subject: string;
  status: EmailStatus;
  error?: string | null;
  providerId?: string | null;
  text?: string | null;
  html?: string | null;
}): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        to: row.to,
        subject: row.subject.slice(0, 300),
        status: row.status,
        error: row.error?.slice(0, 500) ?? null,
        providerId: row.providerId ?? null,
        // ponytail: whole body kept (a few KB each); trim old rows if the table ever gets big.
        text: row.text?.slice(0, 20_000) ?? null,
        html: row.html?.slice(0, 100_000) ?? null,
      },
    });
  } catch (err) {
    console.error("email log write failed", err);
  }
}

// Resend's last_event values that won't change any more.
const FINAL = new Set(["delivered", "bounced", "complained", "failed", "canceled"]);

/**
 * Ask Resend what happened to recent sent emails whose delivery isn't final
 * yet, and save it. ponytail: one GET per email, capped per read; a webhook
 * would push these instead if the log ever gets busy.
 */
export async function refreshDelivery(rows: { id: string; providerId: string | null; delivery: string | null; status: EmailStatus; createdAt: Date }[]) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return new Map<string, string>();
  const weekAgo = new Date().getTime() - 7 * 86_400_000;
  const pending = rows
    .filter((r) => r.status === "SENT" && r.providerId && !FINAL.has(r.delivery ?? "") && r.createdAt.getTime() > weekAgo)
    .slice(0, 30);
  const updates = new Map<string, string>();
  await Promise.all(
    pending.map(async (r) => {
      try {
        const res = await fetch(`https://api.resend.com/emails/${r.providerId}`, { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) return;
        const { last_event } = (await res.json()) as { last_event?: string };
        if (last_event && last_event !== r.delivery) {
          updates.set(r.id, last_event);
          await prisma.emailLog.update({ where: { id: r.id }, data: { delivery: last_event } });
        }
      } catch {
        // Leave it for the next read.
      }
    }),
  );
  return updates;
}
