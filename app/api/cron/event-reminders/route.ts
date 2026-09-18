import { NextRequest, NextResponse } from "next/server";
import { notifyEventGoing } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const REMINDER_WINDOW_HOURS = 24;

/**
 * Vercel Cron hits this once a day (see vercel.json) — reminds everyone
 * RSVP'd GOING to an event starting in the next 24h, once per event
 * (`remindedAt`). ponytail: daily cron + a 24h window is "you get reminded
 * sometime the day before," not an exact "24 hours out" promise — fine for
 * a reminder; tighten the window/cadence if that precision ever matters.
 *
 * Auth: Vercel signs cron requests with `Authorization: Bearer $CRON_SECRET`
 * (set as an env var) — see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 */
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);

  const events = await prisma.event.findMany({
    where: { startsAt: { gte: now, lte: windowEnd }, remindedAt: null },
  });

  for (const event of events) {
    await notifyEventGoing(event.id, `Reminder: ${event.title} is coming up soon.`, "eventReminders");
    await prisma.event.update({ where: { id: event.id }, data: { remindedAt: now } });
  }

  return NextResponse.json({ remindedEvents: events.length });
}
