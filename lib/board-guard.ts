import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isExecAccount, runsWorkspace } from "@/lib/authz";

/**
 * The gate every /api/board route opens with. Six routes repeating the same
 * three-line session check is three chances to get one of them wrong.
 *
 *   const gate = await requireBoard();
 *   if (gate.error) return gate.error;
 *   gate.user // allowed in the workspace, guaranteed
 *
 * `runsWorkspace` is exec-only today (see lib/authz.ts), so the default and
 * the "EXEC_BOARD" level currently mean the same thing. The distinction is
 * kept because it stops meaning the same thing the moment BOARD gets its
 * own surface, and creating a budget should stay exec-only even then.
 */
export async function requireBoard(level: "BOARD" | "EXEC_BOARD" = "BOARD") {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) } as const;
  }
  const allowed =
    level === "EXEC_BOARD" ? isExecAccount(session.user) : runsWorkspace(session.user);
  if (!allowed) {
    return {
      error: NextResponse.json(
        {
          error:
            level === "EXEC_BOARD"
              ? "Only the exec board can do that."
              : "Only the exec board can do that for now.",
        },
        { status: 403 },
      ),
    } as const;
  }
  return { user: session.user } as const;
}

/** Shared by every route that takes a JSON body. */
export async function jsonBody(request: Request) {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
