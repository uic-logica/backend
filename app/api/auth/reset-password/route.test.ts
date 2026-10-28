import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { hashInvite } from "@/lib/invite";
import { verifyPassword } from "@/lib/password";
import { POST as forgot } from "../forgot-password/route";
import { POST as reset } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $executeRaw: vi.fn(), $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() },
  mcpToken: { updateMany: vi.fn() },
  verificationToken: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
} }));

function post(path: string, body: unknown) {
  return new NextRequest(`https://club.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://club.test", "x-forwarded-for": Math.random().toString() },
    body: JSON.stringify(body),
  });
}

const token = "rst_secret";
const link = { identifier: "ada@uic.edu", token: hashInvite(token), expires: new Date(Date.now() + 60_000) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FRONTEND_URL", "https://club.test");
  vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[]));
  vi.mocked(prisma.verificationToken.findUnique).mockResolvedValue(link);
  vi.mocked(prisma.verificationToken.deleteMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", accountKind: "MEMBER" } as never);
});

describe("forgot password", () => {
  it("emails a link whose secret is stored only as a hash", async () => {
    const res = await forgot(post("/api/auth/forgot-password", { email: " Ada@UIC.edu " }));
    expect(await res.json()).toEqual({ ok: true });
    const mail = vi.mocked(sendMail).mock.calls[0][0];
    expect(mail.to).toBe("ada@uic.edu");
    const secret = mail.text.match(/#token=(rst_[\w-]+)/)![1];
    const stored = vi.mocked(prisma.verificationToken.create).mock.calls[0][0].data;
    expect(stored).toMatchObject({ identifier: "ada@uic.edu", token: hashInvite(secret) });
    expect(stored.token).not.toContain(secret);
  });

  it("gives the same answer and sends nothing for an unknown address", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await forgot(post("/api/auth/forgot-password", { email: "nobody@uic.edu" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.verificationToken.create).not.toHaveBeenCalled();
  });

  it("caps requests per address", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await forgot(post("/api/auth/forgot-password", { email: "cap@uic.edu" }))).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("reset password", () => {
  it("sets the new password, signs out everywhere, and spends every link", async () => {
    const res = await reset(post("/api/auth/reset-password", { token, password: "a brand new password" }));
    expect(await res.json()).toEqual({ ok: true, accountKind: "MEMBER" });
    const data = vi.mocked(prisma.user.update).mock.calls[0][0].data as { passwordHash: string; mustChangePassword: boolean };
    expect(verifyPassword("a brand new password", data.passwordHash)).toBe(true);
    expect(data.mustChangePassword).toBe(false);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(prisma.mcpToken.updateMany).toHaveBeenCalled();
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: "ada@uic.edu" } });
  });

  it.each([
    ["unknown", () => vi.mocked(prisma.verificationToken.findUnique).mockResolvedValue(null)],
    ["expired", () => vi.mocked(prisma.verificationToken.findUnique).mockResolvedValue({ ...link, expires: new Date(0) })],
    ["already spent by a concurrent request", () => vi.mocked(prisma.verificationToken.deleteMany).mockResolvedValue({ count: 0 })],
  ])("refuses an %s link without touching the account", async (_, arrange) => {
    arrange();
    const res = await reset(post("/api/auth/reset-password", { token, password: "a brand new password" }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("enforces the signup password rule", async () => {
    const res = await reset(post("/api/auth/reset-password", { token, password: "short" }));
    expect(res.status).toBe(400);
    expect(prisma.verificationToken.findUnique).not.toHaveBeenCalled();
  });
});
