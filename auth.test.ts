import { describe, expect, it, vi } from "vitest";

const raw = vi.fn();
vi.mock("next-auth", () => ({ default: () => ({ auth: raw, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { auth, partnerAuth } = await import("./auth");

describe("auth()", () => {
  it("reads a partner club's session as signed out, so every route refuses it by default", async () => {
    raw.mockResolvedValue({ user: { id: "p1", accountKind: "PARTNER", role: "MEMBER" } });
    expect(await auth()).toBeNull();
    expect(await partnerAuth()).toMatchObject({ user: { id: "p1" } });
  });

  it("passes member and guest sessions through unchanged", async () => {
    for (const accountKind of ["MEMBER", "SPEAKER"]) {
      const session = { user: { id: "u1", accountKind, role: "MEMBER" } };
      raw.mockResolvedValue(session);
      expect(await auth()).toBe(session);
    }
  });
});
