import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST, GET } from "./route";

const rpc = (body: unknown, token?: string) =>
  POST(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
  );

/**
 * Auth is the whole security boundary here — a bearer token is all an
 * agent presents, so an unauthenticated or bogus one must never reach a
 * tool. These cases are rejected before any database call.
 */
describe("MCP transport auth", () => {
  it("rejects a request with no token", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("rejects a token that isn't ours", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "sk-someone-elses")).status).toBe(401);
  });

  it("rejects an empty bearer value", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "   ")).status).toBe(401);
  });

  it("refuses GET — nothing here streams to the client", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
