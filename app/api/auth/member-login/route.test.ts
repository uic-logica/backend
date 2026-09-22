import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
  user: { findUnique: vi.fn() }, session: { create: vi.fn() },
} }));

const password = "a-generated-password-1234";
const user = { id: "member-1", accountKind: "MEMBER", role: "MEMBER", passwordHash: hashPassword(password) } as User;
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://club.test/api/auth/member-login", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://club.test", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "uic.edu");
  vi.stubEnv("FRONTEND_URL", "https://club.test");
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prisma) => Promise<unknown>)(prisma));
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ guesses: 1 }]);
  vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
});

describe("member password login", () => {
  it.each(["MEMBER", "BOARD", "EXEC_BOARD"] as const)("accepts %s and sets a secure HTTP-only session without returning secrets", async (role) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...user, role });
    const response = await POST(request({ email: " Person@UIC.EDU ", password, role: "EXEC_BOARD" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "person@uic.edu" } });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("__Secure-authjs.session-token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(prisma.session.create).toHaveBeenCalledOnce();
  });

  it.each([null, { ...user, passwordHash: null }, { ...user, accountKind: "SPEAKER" }, { ...user, passwordHash: "scrypt::" }])("rejects missing, unprovisioned, guest, and corrupt accounts", async (record) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(record as User | null);
    const response = await POST(request({ email: "person@uic.edu", password }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Incorrect email or password." });
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it("rejects a wrong password without creating a session", async () => {
    const response = await POST(request({ email: "person@uic.edu", password: "wrong" }));
    expect(response.status).toBe(401);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { email: "person@uic.edu", password: 123 }, { email: "person@uic.edu", password: "x".repeat(129) }, { email: "person@uic.edu.evil.com", password }, { email: "a@b@uic.edu", password }])("rejects invalid inputs before database work", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("fails closed without the configured university domain", async () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");
    expect((await POST(request({ email: "person@uic.edu", password }))).status).toBe(400);
  });

  it("rejects even a correct password when over the persistent attempt limit", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ guesses: 11 }]);
    const response = await POST(request({ email: "person@uic.edu", password }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("rejects cross-origin and non-JSON requests", async (headers) => {
    const response = await POST(request({ email: "person@uic.edu", password }, headers));
    expect([403, 415]).toContain(response.status);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new NextRequest("https://club.test/api/auth/member-login", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
  });
});
