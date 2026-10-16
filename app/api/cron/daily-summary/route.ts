import { NextRequest, NextResponse } from "next/server";
import { frontendOrigin } from "@/lib/linkedin-oauth";
import { emailTo } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const time = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * Vercel Cron, 9 AM Chicago (vercel.json): one email per person with
 * everything held for their summary since the last one, oldest first. Nobody
 * with nothing waiting gets an email.
 *
 * ponytail: the cron is set in UTC, so it's 9 AM in daylight time and 8 AM
 * in winter. Add a second schedule if the hour has to hold all year.
 */
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  const waiting = await prisma.notification.findMany({
    where: { emailLater: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, message: true, createdAt: true, user: { select: { email: true } } },
  });
  const byUser = Map.groupBy(waiting, (n) => n.userId);

  for (const items of byUser.values()) {
    const count = `${items.length} update${items.length === 1 ? "" : "s"}`;
    await emailTo(items[0].user.email, `Your LOGICA summary: ${count}`, {
      preheader: items.map((n) => n.message).join(" · ").slice(0, 120),
      eyebrow: "Daily summary",
      heading: `${count} since yesterday`,
      paragraphs: [],
      details: items.map((n) => [time(n.createdAt), n.message]),
      button: { label: "Open your notifications", url: `${frontendOrigin()}/dashboard/notifications` },
      footnote: "You get this at 9 AM when something happened. Change what goes in it under Settings, Email preferences.",
    });
    await prisma.notification.updateMany({ where: { id: { in: items.map((n) => n.id) } }, data: { emailLater: false } });
  }
  return NextResponse.json({ sent: byUser.size, items: waiting.length });
}
