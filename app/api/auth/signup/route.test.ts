import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { overAttemptLimit } from "@/lib/rate-limit";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn(() => "stored-password-hash") }));
vi.mock("@/lib/rate-limit", () => ({ overAttemptLimit: vi.fn(() => false) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $executeRaw: vi.fn(), $transaction: vi.fn(),
  // `update` is mocked purely so the "existing account is left alone" test can
  // assert it was never called — the route has no reason to reach for it.
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  session: { create: vi.fn() },
} }));

function request(
  body: unknown,
  headers: Record<string, string> = {},
  url = "https://club.test/api/auth/signup",
) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://club.test", ...headers },
    body: JSON.stringify(body),
  });
}

const valid = { name: "Ada Lovelace", email: "ada@uic.edu", password: "correct horse battery" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
  vi.stubEnv("FRONTEND_URL", "https://club.test");
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(overAttemptLimit).mockReturnValue(false);
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prisma) => Promise<unknown>)(prisma));
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.user.create).mockResolvedValue({ id: "member-1" } as never);
});

describe("public member signup", () => {
  it("rejects an email outside the allowed university domain", async () => {
    expect((await POST(request({ ...valid, email: "ada@example.com" }))).status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(["short", "x".repeat(201)])("rejects an invalid password length", async (password) => {
    expect((await POST(request({ ...valid, password }))).status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects a caller who already has a session", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "member-1" } } as never);
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ reason: "signed-in" });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("creates only a MEMBER account despite role and account-kind fields in the body", async () => {
    const response = await POST(request(
      { ...valid, role: "EXEC_BOARD", accountKind: "SPEAKER" },
      {},
      "https://club.test/api/auth/signup?role=EXEC_BOARD&accountKind=SPEAKER",
    ));
    expect(response.status).toBe(200);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        name: valid.name,
        email: valid.email,
        passwordHash: "stored-password-hash",
        accountKind: "MEMBER",
        role: "MEMBER",
      },
      select: { id: true },
    });
  });

  it("refuses an email that already has an account, without touching it", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "member-1" } as never);

    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ reason: "exists" });
    // The existing account must be left exactly as it was: no overwritten
    // password, and above all no session — that would be a takeover, not a signup.
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("establishes a secure session after successful signup", async () => {
    const response = await POST(request(valid));
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("__Secure-authjs.session-token=");
    expect(prisma.session.create).toHaveBeenCalledOnce();
  });
});
