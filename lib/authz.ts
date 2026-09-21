import type { Role } from "@prisma/client";

const ROLE_RANK: Record<Role, number> = {
  MEMBER: 0,
  BOARD: 1,
  EXEC_BOARD: 2,
};

export function hasRole(userRole: Role, minimumRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[minimumRole];
}

export function requireRole(userRole: Role, minimumRole: Role): void {
  if (!hasRole(userRole, minimumRole)) {
    throw new Error("FORBIDDEN");
  }
}

/**
 * Role on its own is not enough: Role is meaningless on a SPEAKER account
 * (see AUTH.md), so a SPEAKER row carrying `role: BOARD` would pass a bare
 * `hasRole` check. AUTH.md says that state shouldn't exist; nothing enforces
 * it, so these two check both halves. Use them for anything board-facing.
 */
type Account = { accountKind: string; role: Role };

export function isBoardAccount(user: Account): boolean {
  return user.accountKind === "MEMBER" && hasRole(user.role, "BOARD");
}

export function isExecAccount(user: Account): boolean {
  return user.accountKind === "MEMBER" && user.role === "EXEC_BOARD";
}

/**
 * Who the board workspace is open to — money, the outreach pipeline, the
 * roster, insights, documents, the guest directory.
 *
 * Exec only for now. BOARD is a real tier that will get its own surface;
 * until someone decides what belongs on it, board members see the member
 * view. This is the one place to widen it, and the frontend's
 * `runsWorkspace` in components/dashboard/types.ts is its mirror.
 */
export function runsWorkspace(user: Account): boolean {
  return isExecAccount(user);
}