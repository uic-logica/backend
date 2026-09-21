/**
 * The five kinds of person on this platform, in one place.
 *
 * Role alone doesn't say it: a SPEAKER account is a candidate or a speaker
 * depending on whether the board has confirmed their submission, and BOARD
 * vs EXEC_BOARD is a Role on a MEMBER account. Everything that branches on
 * "who is this" — MCP tools, dashboard nav, what the API will accept —
 * derives it here so the five never drift apart.
 */
export type Stage =
  | "CANDIDATE"
  | "SPEAKER"
  | "MEMBER"
  | "BOARD"
  | "EXEC_BOARD";

export const STAGE_LABELS: Record<Stage, string> = {
  CANDIDATE: "Candidate",
  SPEAKER: "Guest speaker",
  MEMBER: "Member",
  BOARD: "Board member",
  EXEC_BOARD: "Exec board",
};

export function stageOf(
  accountKind: string,
  role: string,
  submissionStatus?: string | null,
): Stage {
  if (accountKind === "SPEAKER") {
    return submissionStatus === "CONFIRMED" ? "SPEAKER" : "CANDIDATE";
  }
  if (role === "EXEC_BOARD") return "EXEC_BOARD";
  if (role === "BOARD") return "BOARD";
  return "MEMBER";
}

/** Board and exec board share most of the club's back office. */
export function runsTheClub(stage: Stage) {
  return stage === "BOARD" || stage === "EXEC_BOARD";
}
