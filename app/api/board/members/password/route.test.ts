import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
  user: { findUnique: vi.fn(), upsert: vi.fn() },
  session: { deleteMany: vi.fn() }, mcpToken: { updateMany: vi.fn() },
  verificationToken: { deleteMany: vi.fn() },
} }));
const actor = { id: "exec-1", email: "exec@uic.edu", accountKind: "MEMBER", role: "EXEC_BOARD" };
function asUser(user: unknown) {
  vi.mocked(auth).mockResolvedValue((user ? { user } : null) as never);
}
function request(email = "member@uic.edu", extra = {}) {
  return new NextRequest("https://club.test/api/board/members/password", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://club.test" },
    body: JSON.stringify({ email, ...extra }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
  vi.stubEnv("FRONTEND_URL", "https://club.test");
  asUser(actor);
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prisma) => Promise<unknown>)(prisma));
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "member-1", accountKind: "MEMBER", role: "BOARD" } as User);
  vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "member-1", email: "member@uic.edu" } as User);
});

describe("exec credential issuance", () => {
  it.each([null, { ...actor, role: "MEMBER" }, { ...actor, role: "BOARD" }, { ...actor, accountKind: "SPEAKER" }])("rejects anonymous, members, board, and guest accounts", async (user) => {
    asUser(user);
    expect((await POST(request())).status).toBe(user ? 403 : 401);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("generates a strong password, stores only its hash, preserves roles, and revokes sessions and tokens", async () => {
    const response = await POST(request("member@uic.edu", { role: "EXEC_BOARD", password: "weak" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(body.passwordHash).toBeUndefined();
    const args = vi.mocked(prisma.user.upsert).mock.calls[0][0];
    expect(args.create.role).toBeUndefined();
    expect(args.update.role).toBeUndefined();
    expect(verifyPassword(body.password, args.update.passwordHash as string)).toBe(true);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "member-1" } });
    expect(prisma.mcpToken.updateMany).toHaveBeenCalled();
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: "member@uic.edu" } });
  });

  it("creates a new member without granting a board role", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(200);
    expect(vi.mocked(prisma.user.upsert).mock.calls[0][0].create.accountKind).toBe("MEMBER");
  });

  it("refuses to overwrite a guest account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accountKind: "SPEAKER" } as User);
    expect((await POST(request())).status).toBe(409);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("requires another exec to reset the acting exec", async () => {
    expect((await POST(request(" EXEC@UIC.EDU "))).status).toBe(400);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("rejects non-university addresses", async () => {
    expect((await POST(request("member@gmail.com"))).status).toBe(400);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
