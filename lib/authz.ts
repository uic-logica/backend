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