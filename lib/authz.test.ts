import { describe, it, expect } from "vitest";
import { hasRole, requireRole } from "./authz";

describe("requireRole", () => {
  it("blocks MEMBER from BOARD and EXEC_BOARD actions", () => {
    expect(() => requireRole("MEMBER", "BOARD")).toThrow("FORBIDDEN");
    expect(() => requireRole("MEMBER", "EXEC_BOARD")).toThrow("FORBIDDEN");
  });

  it("blocks BOARD from EXEC_BOARD actions", () => {
    expect(() => requireRole("BOARD", "EXEC_BOARD")).toThrow("FORBIDDEN");
  });

  it("allows a role to access its own level or below", () => {
    expect(() => requireRole("BOARD", "BOARD")).not.toThrow();
    expect(() => requireRole("EXEC_BOARD", "BOARD")).not.toThrow();
    expect(() => requireRole("EXEC_BOARD", "MEMBER")).not.toThrow();
  });
});

describe("hasRole", () => {
  it("returns false below the minimum, true at or above it", () => {
    expect(hasRole("MEMBER", "BOARD")).toBe(false);
    expect(hasRole("BOARD", "BOARD")).toBe(true);
    expect(hasRole("EXEC_BOARD", "MEMBER")).toBe(true);
  });
});
