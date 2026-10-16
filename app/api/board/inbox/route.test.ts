import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { tell } from "@/lib/notify";
import { GET } from "./route";
import { GET as readThread, POST as writeThread } from "../messages/[userId]/route";
import { GET as myThread, POST as writeMine } from "../../messages/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ tell: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    speakerMessage: { findMany: vi.fn() },
    boardMessage: { findMany: vi.fn(), create: vi.fn() },
    membershipApplication: { findMany: vi.fn() },
    threadRead: { findMany: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  },
}));

const as = (id: string, role: string, accountKind = "MEMBER") =>
  vi.mocked(auth).mockResolvedValue({ user: { id, role, accountKind }, expires: "" } as never);
const post = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const params = (userId: string) => ({ params: Promise.resolve({ userId }) });
const at = (min: number) => new Date(Date.UTC(2026, 9, 15, 12, min));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.speakerMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.boardMessage.findMany).mockResolvedValue([]);
  vi.mocked(prisma.membershipApplication.findMany).mockResolvedValue([]);
  vi.mocked(prisma.threadRead.findMany).mockResolvedValue([]);
  vi.mocked(prisma.boardMessage.create).mockResolvedValue({ id: "b1" } as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "exec1" }, { id: "exec2" }] as never);
});

describe("board inbox", () => {
  it("is exec only", async () => {
    for (const [role, kind] of [["MEMBER", "MEMBER"], ["BOARD", "MEMBER"], ["EXEC_BOARD", "SPEAKER"]]) {
      as("u1", role, kind);
      expect((await GET()).status).toBe(403);
      expect((await readThread(new NextRequest("http://localhost/x"), params("m1"))).status).toBe(403);
      expect((await writeThread(post({ body: "hi" }), params("m1"))).status).toBe(403);
    }
  });

  it("lists guest and member threads newest first, unread when the other side wrote after this exec read", async () => {
    as("exec1", "EXEC_BOARD");
    vi.mocked(prisma.speakerMessage.findMany).mockResolvedValue([
      { body: "Tuesday works", createdAt: at(30), author: { accountKind: "SPEAKER" }, submission: { id: "s1", name: "Jona", email: "j@x.com", organization: "Rise", sharing: [{ name: "Lucas" }] } },
    ] as never);
    vi.mocked(prisma.boardMessage.findMany).mockResolvedValue([
      { body: "Thanks!", createdAt: at(40), authorId: "exec2", memberId: "m1", member: { id: "m1", name: "Ana", email: "a@uic.edu", role: "MEMBER" } },
    ] as never);
    vi.mocked(prisma.membershipApplication.findMany).mockResolvedValue([{ userId: "m1", status: "INTERVIEW" }] as never);
    vi.mocked(prisma.threadRead.findMany).mockResolvedValue([{ userId: "exec1", thread: "speaker:s1", readAt: at(10) }] as never);
    const threads = await (await GET()).json();
    expect(threads.map((t: { thread: string }) => t.thread)).toEqual(["member:m1", "speaker:s1"]);
    expect(threads[0]).toMatchObject({ name: "Ana", detail: "Applicant · Interview", unread: false });
    expect(threads[1]).toMatchObject({ name: "Jona & Lucas", detail: "Guest · Rise", unread: true });
  });

  it("an exec reply reaches the member and marks the thread read for that exec", async () => {
    as("exec1", "EXEC_BOARD");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "m1", accountKind: "MEMBER" } as never);
    expect((await writeThread(post({ body: "  See you Tuesday " }), params("m1"))).status).toBe(201);
    expect(prisma.boardMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: { memberId: "m1", authorId: "exec1", body: "See you Tuesday" } }));
    expect(prisma.threadRead.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_thread: { userId: "exec1", thread: "member:m1" } } }));
    expect(tell).toHaveBeenCalledWith({ userId: "m1" }, expect.stringContaining("See you Tuesday"), expect.any(String), expect.anything());
  });

  it("won't open a thread with a guest account or someone who doesn't exist", async () => {
    as("exec1", "EXEC_BOARD");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "g1", accountKind: "SPEAKER" } as never);
    expect((await writeThread(post({ body: "hi" }), params("g1"))).status).toBe(404);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect((await readThread(new NextRequest("http://localhost/x"), params("nope"))).status).toBe(404);
  });
});

describe("a member's own thread", () => {
  it("reads only their own thread; guests use their portal", async () => {
    as("m1", "MEMBER");
    await myThread();
    expect(prisma.boardMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "m1" } }));
    as("g1", "SPEAKER", "SPEAKER");
    expect((await myThread()).status).toBe(403);
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await myThread()).status).toBe(401);
  });

  it("writing tells every exec, and refuses empty or long messages", async () => {
    as("m1", "MEMBER");
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ id: "m1", name: "Ana", email: "a@uic.edu" } as never);
    expect((await writeMine(post({ body: "" }))).status).toBe(400);
    expect((await writeMine(post({ body: "x".repeat(2001) }))).status).toBe(400);
    expect((await writeMine(post({ body: "Can I still join the hackathon team?" }))).status).toBe(201);
    expect(prisma.boardMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: { memberId: "m1", authorId: "m1", body: "Can I still join the hackathon team?" } }));
    expect(tell).toHaveBeenCalledTimes(2);
    expect(vi.mocked(tell).mock.calls[0][2]).toBe("Ana wrote to the board");
  });
});
