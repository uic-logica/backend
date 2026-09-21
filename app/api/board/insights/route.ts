import { NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { clubInsights } from "@/lib/insights";

/** Board+ only. The numbers themselves live in lib/insights.ts — the MCP
 *  `club_insights` tool answers the same question from the same code. */
export async function GET() {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  return NextResponse.json(await clubInsights());
}
