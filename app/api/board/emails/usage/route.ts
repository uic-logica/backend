import { NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { prisma } from "@/lib/prisma";

// Resend's free plan: 3,000 emails a month and 100 a day (it counts in UTC).
// ponytail: plan limits hard-coded; change these two if the plan changes.
const MONTH_LIMIT = 3000;
const DAY_LIMIT = 100;

/** Exec only: how much of the email allowance this month and today is used, from the email log. */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [month, day] = await Promise.all([
    prisma.emailLog.count({ where: { status: "SENT", createdAt: { gte: monthStart } } }),
    prisma.emailLog.count({ where: { status: "SENT", createdAt: { gte: dayStart } } }),
  ]);
  return NextResponse.json({ month, monthLimit: MONTH_LIMIT, day, dayLimit: DAY_LIMIT });
}
