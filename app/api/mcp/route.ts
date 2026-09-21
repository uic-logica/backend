import { NextRequest, NextResponse } from "next/server";
import { callerFor } from "@/lib/mcp-token";
import { TOOLS, toolsFor } from "@/lib/mcp-tools";
import { STAGE_LABELS } from "@/lib/stage";

/**
 * MCP server — Streamable HTTP, stateless.
 *
 * Hand-rolled rather than pulled from the SDK: a tools-only server is three
 * JSON-RPC methods (`initialize`, `tools/list`, `tools/call`) over POST, and
 * that is genuinely less code than wiring the SDK's transport into a Next
 * route handler. No session id, no SSE stream — every request stands alone,
 * authenticated by its own bearer token.
 *
 * The tool list is derived per caller, so a candidate's agent is never even
 * told that `decide_on_guest` exists. That's presentation; the real control
 * is that `tools/call` re-checks the caller's stage before running anything.
 */
const PROTOCOL_VERSION = "2025-06-18";

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

const result = (id: unknown, value: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result: value });

const error = (id: unknown, code: number, message: string, status = 200) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });

export async function GET() {
  // No server-initiated stream: nothing here pushes to the client.
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function POST(request: NextRequest) {
  const caller = await callerFor(request.headers.get("authorization"));
  if (!caller) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized. Send a LOGICA MCP token as `Authorization: Bearer <token>`." } },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="LOGICA"' } },
    );
  }

  let body: Rpc;
  try {
    body = (await request.json()) as Rpc;
  } catch {
    return error(null, -32700, "Parse error: body must be JSON.", 400);
  }

  const { id = null, method, params = {} } = body;

  // Notifications (no id) get an empty 202 — the spec expects no body.
  if (method?.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "logica-uic", version: "1.0.0" },
        instructions: `You are acting for ${caller.name ?? caller.email}, a ${STAGE_LABELS[caller.stage]} at LOGICA @ UIC. Only the tools for that role are listed. Day-to-day conversation lives in the club's Discord; this platform holds the things that need a record — availability, talks, RSVPs and the board's decisions.`,
      });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: toolsFor(caller.stage).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = String(params.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      // Same answer whether the tool doesn't exist or isn't theirs — no
      // reason to teach a candidate's agent the board's tool names.
      if (!tool || !tool.stages.includes(caller.stage)) {
        return error(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const value = await tool.run((params.arguments ?? {}) as Record<string, unknown>, caller);
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        });
      } catch (err) {
        // A tool that refuses is a result the model should read and react
        // to, not a transport failure — isError, not a JSON-RPC error.
        return result(id, {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : "That didn't work." }],
        });
      }
    }

    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}
