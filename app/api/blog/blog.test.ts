import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { blogCover, blogExcerpt, blogSlug } from "@/lib/blog";
import { prisma } from "@/lib/prisma";
import * as list from "./route";
import * as one from "./[slug]/route";
import * as mine from "./mine/route";
import * as mineOne from "./mine/[id]/route";
import * as review from "./review/route";
import * as reviewOne from "./review/[id]/route";
import * as images from "./images/route";
import * as image from "./images/[id]/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    blogPost: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    blogImage: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));

const as = (role: string | null, accountKind = "MEMBER", id = "u1") =>
  vi.mocked(auth).mockResolvedValue((role ? { user: { id, name: "Ana", role, accountKind }, expires: "" } : null) as never);
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/blog", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const id = { params: Promise.resolve({ id: "p1" }) };
const post = (status: string, authorId = "u1") => ({ id: "clxpost0abc123", authorId, title: "Hack Night recap", status, slug: null });

beforeEach(() => {
  vi.clearAllMocks();
  as("MEMBER");
  vi.mocked(prisma.blogPost.create).mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }) as never);
  vi.mocked(prisma.blogPost.update).mockImplementation(({ data }) => Promise.resolve({ id: "p1", ...data }) as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "exec1" }] as never);
});

describe("public reads", () => {
  it("only ever ask for published posts", async () => {
    vi.mocked(prisma.blogPost.findMany).mockResolvedValue([{ body: "One.\n\nTwo.", title: "t" }] as never);
    as(null);
    const body = await (await list.GET()).json();
    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "PUBLISHED" } }));
    expect(body[0]).toEqual({ title: "t", excerpt: "One.", cover: null });

    vi.mocked(prisma.blogPost.findFirst).mockResolvedValue(null);
    const res = await one.GET(req("GET"), { params: Promise.resolve({ slug: "draft-x" }) });
    expect(prisma.blogPost.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "draft-x", status: "PUBLISHED" } }));
    expect(res.status).toBe(404);
  });
});

describe("writing", () => {
  it("creates a draft, or a submitted post that pings the execs", async () => {
    expect((await mine.POST(req("POST", { title: "Hi", body: "Words" }))).status).toBe(201);
    expect((await import("@/lib/notify")).notifyUser).not.toHaveBeenCalled();
    await mine.POST(req("POST", { title: "Hi", body: "Words", submit: true }));
    expect(prisma.blogPost.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ status: "SUBMITTED", authorId: "u1" }),
    });
    const { notifyUser } = await import("@/lib/notify");
    expect(notifyUser).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("for review"), "boardUpdates", expect.any(String), undefined, expect.stringContaining("/dashboard/blog?view=review"));
  });

  it("needs a title and a body, and a member account", async () => {
    expect((await mine.POST(req("POST", { title: " ", body: "x" }))).status).toBe(400);
    expect((await mine.POST(req("POST", { title: "x" }))).status).toBe(400);
    as("MEMBER", "SPEAKER");
    expect((await mine.POST(req("POST", { title: "x", body: "y" }))).status).toBe(403);
    as(null);
    expect((await mine.POST(req("POST", { title: "x", body: "y" }))).status).toBe(401);
    expect(prisma.blogPost.create).not.toHaveBeenCalled();
  });

  it("lets the author edit, submit and withdraw only their own unpublished post", async () => {
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("REJECTED") as never);
    await mineOne.PATCH(req("PATCH", { body: "Better", submit: true }), id);
    expect(prisma.blogPost.update).toHaveBeenLastCalledWith({
      where: { id: "clxpost0abc123" },
      data: expect.objectContaining({ body: "Better", status: "SUBMITTED" }),
    });
    await mineOne.PATCH(req("PATCH", { submit: false }), id);
    expect(prisma.blogPost.update).toHaveBeenLastCalledWith({
      where: { id: "clxpost0abc123" },
      data: { status: "DRAFT", submittedAt: null },
    });

    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("DRAFT", "someone-else") as never);
    expect((await mineOne.PATCH(req("PATCH", { title: "mine now" }), id)).status).toBe(404);
    expect((await mineOne.DELETE(req("DELETE"), id)).status).toBe(404);

    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("PUBLISHED") as never);
    expect((await mineOne.PATCH(req("PATCH", { title: "sneaky" }), id)).status).toBe(409);
    expect((await mineOne.DELETE(req("DELETE"), id)).status).toBe(409);
    expect(prisma.blogPost.delete).not.toHaveBeenCalled();
  });
});

describe("review", () => {
  it("is exec only", async () => {
    for (const [role, kind, status] of [
      ["MEMBER", "MEMBER", 403],
      ["BOARD", "MEMBER", 403],
      ["EXEC_BOARD", "SPEAKER", 403],
      [null, "MEMBER", 401],
    ] as const) {
      as(role, kind);
      expect((await review.GET()).status).toBe(status);
      expect((await reviewOne.PATCH(req("PATCH", { action: "publish" }), id)).status).toBe(status);
    }
    expect(prisma.blogPost.update).not.toHaveBeenCalled();
  });

  it("publishes a submitted post with a slug and tells the author", async () => {
    as("EXEC_BOARD");
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("SUBMITTED") as never);
    expect((await reviewOne.PATCH(req("PATCH", { action: "publish" }), id)).status).toBe(200);
    expect(prisma.blogPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED", slug: "hack-night-recap-abc123" }) }),
    );
    const { notifyUser } = await import("@/lib/notify");
    expect(notifyUser).toHaveBeenCalledWith("u1", expect.stringContaining("is live"), "decisions", undefined, undefined, "/dashboard/blog?id=clxpost0abc123");
  });

  it("needs a note to send back, and only acts on the right status", async () => {
    as("EXEC_BOARD");
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("SUBMITTED") as never);
    expect((await reviewOne.PATCH(req("PATCH", { action: "reject" }), id)).status).toBe(400);
    expect((await reviewOne.PATCH(req("PATCH", { action: "unpublish" }), id)).status).toBe(409);
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("DRAFT") as never);
    expect((await reviewOne.PATCH(req("PATCH", { action: "publish" }), id)).status).toBe(404);
    expect(prisma.blogPost.update).not.toHaveBeenCalled();

    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(post("PUBLISHED") as never);
    await reviewOne.PATCH(req("PATCH", { action: "unpublish" }), id);
    expect(prisma.blogPost.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "REJECTED", reviewNote: null } }));
  });
});

describe("helpers", () => {
  it("slugs and excerpts", () => {
    expect(blogSlug("¡Qué onda, LOGICA!", "abcdef123456")).toBe("que-onda-logica-123456");
    expect(blogSlug("!!!", "abcdef123456")).toBe("123456");
    expect(blogExcerpt("a ".repeat(150)).length).toBeLessThanOrEqual(200);
  });

  it("excerpts skip pictures and headings, strip links; the first picture is the cover", () => {
    const body = "![Yurii](/api/blog/images/clximg1)\n\n## Why him\n\nHe judged [HackHarvard](https://hackharvard.io).\n\n![](/api/blog/images/clximg2)";
    expect(blogExcerpt(body)).toBe("He judged HackHarvard.");
    expect(blogCover(body)).toBe("/api/blog/images/clximg1");
    expect(blogCover("![x](https://evil.example/x.png)")).toBeNull();
  });
});

describe("blog pictures", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString("base64");
  const upload = (body: unknown) => images.POST(req("POST", body));

  it("members upload a picture and get its URL back", async () => {
    vi.mocked(prisma.blogImage.count).mockResolvedValue(0);
    vi.mocked(prisma.blogImage.create).mockResolvedValue({ id: "clximg1" } as never);
    const res = await upload({ filename: "yurii.png", mimeType: "image/png", data: png });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "clximg1", url: "/api/blog/images/clximg1" });
    expect(prisma.blogImage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorId: "u1", mimeType: "image/png" }) }));
  });

  it("refuses guests, speakers, non-images and members over the cap", async () => {
    as(null);
    expect((await upload({ filename: "a.png", mimeType: "image/png", data: png })).status).toBe(401);
    as("MEMBER", "SPEAKER");
    expect((await upload({ filename: "a.png", mimeType: "image/png", data: png })).status).toBe(403);
    as("MEMBER");
    expect((await upload({ filename: "a.svg", mimeType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") })).status).toBe(400);
    expect((await upload({ filename: "a.png", mimeType: "image/png", data: Buffer.from("%PDF-1").toString("base64") })).status).toBe(400);
    vi.mocked(prisma.blogImage.count).mockResolvedValue(100);
    expect((await upload({ filename: "a.png", mimeType: "image/png", data: png })).status).toBe(429);
    expect(prisma.blogImage.create).not.toHaveBeenCalled();
  });

  it("serves a picture publicly with a long cache, 404s unknown ids", async () => {
    as(null);
    vi.mocked(prisma.blogImage.findUnique).mockResolvedValue({ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) } as never);
    const res = await image.GET(req("GET"), { params: Promise.resolve({ id: "clximg1" }) });
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    vi.mocked(prisma.blogImage.findUnique).mockResolvedValue(null);
    expect((await image.GET(req("GET"), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});
