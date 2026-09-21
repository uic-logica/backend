import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBoardAccount, isExecAccount } from "@/lib/authz";

/**
 * The gate every /api/board route opens with. Six routes repeating the same
 * three-line session check is three chances to get one of them wrong.
 *
 *   const gate = await requireBoard();
 *   if (gate.error) return gate.error;
 *   gate.user // board member, guaranteed
 */
export async function requireBoard(level: "BOARD" | "EXEC_BOARD" = "BOARD") {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) } as const;
  }
  const allowed =
    level === "EXEC_BOARD" ? isExecAccount(session.user) : isBoardAccount(session.user);
  if (!allowed) {
    return {
      error: NextResponse.json(
        {
          error:
            level === "EXEC_BOARD"
              ? "Only the exec board can do that."
              : "Only board members can do that.",
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
