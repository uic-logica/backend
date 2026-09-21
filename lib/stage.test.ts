import { describe, expect, it } from "vitest";
import { stageOf, runsTheClub } from "./stage";
import { TOOLS, toolsFor } from "./mcp-tools";

describe("stageOf", () => {
  it("splits a speaker account on the board's decision", () => {
    expect(stageOf("SPEAKER", "MEMBER", "PENDING")).toBe("CANDIDATE");
    expect(stageOf("SPEAKER", "MEMBER", "DECLINED")).toBe("CANDIDATE");
    expect(stageOf("SPEAKER", "MEMBER", null)).toBe("CANDIDATE");
    expect(stageOf("SPEAKER", "MEMBER", "CONFIRMED")).toBe("SPEAKER");
  });

  it("ignores Role on a speaker account", () => {
    // Role is meaningless for SPEAKER accounts — see AUTH.md. A stray
    // EXEC_BOARD there must never promote a guest.
    expect(stageOf("SPEAKER", "EXEC_BOARD", "PENDING")).toBe("CANDIDATE");
    expect(stageOf("SPEAKER", "EXEC_BOARD", "CONFIRMED")).toBe("SPEAKER");
  });

  it("splits a member account on Role", () => {
    expect(stageOf("MEMBER", "MEMBER")).toBe("MEMBER");
    expect(stageOf("MEMBER", "BOARD")).toBe("BOARD");
    expect(stageOf("MEMBER", "EXEC_BOARD")).toBe("EXEC_BOARD");
  });

  it("counts board and exec board as running the club", () => {
    expect(runsTheClub("BOARD")).toBe(true);
    expect(runsTheClub("EXEC_BOARD")).toBe(true);
    expect(runsTheClub("MEMBER")).toBe(false);
    expect(runsTheClub("SPEAKER")).toBe(false);
    expect(runsTheClub("CANDIDATE")).toBe(false);
  });
});

describe("MCP tools per stage", () => {
  const names = (stage: Parameters<typeof toolsFor>[0]) =>
    toolsFor(stage).map((t) => t.name);

  it("gives a candidate availability but not a talk", () => {
    expect(names("CANDIDATE")).toContain("set_availability");
    expect(names("CANDIDATE")).toContain("confirm_availability");
    expect(names("CANDIDATE")).not.toContain("set_talk");
    expect(names("CANDIDATE")).not.toContain("get_talk_stats");
  });

  it("gives a confirmed speaker the talk tools too", () => {
    expect(names("SPEAKER")).toContain("set_availability");
    expect(names("SPEAKER")).toContain("set_talk");
    expect(names("SPEAKER")).toContain("get_talk_stats");
  });

  it("keeps the guest pipeline to exec", () => {
    for (const tool of ["list_guests", "decide_on_guest", "schedule_guest", "create_event"]) {
      expect(names("EXEC_BOARD"), tool).toContain(tool);
      for (const stage of ["BOARD", "MEMBER", "CANDIDATE", "SPEAKER"] as const) {
        expect(names(stage), `${tool} / ${stage}`).not.toContain(tool);
      }
    }
  });

  /**
   * The workspace tools. A guest with a token must never see the club's
   * budget, and BOARD does not see it either right now — board members are
   * on the member view until that tier gets its own surface, and an agent
   * must not be the way around that. Mirrors runsWorkspace() in lib/authz.
   */
  it("keeps money, outreach and the roster to exec", () => {
    const workspace = [
      "list_board_items",
      "add_board_item",
      "update_board_item",
      "budget_status",
      "club_insights",
      "find_documents",
    ];
    for (const tool of workspace) {
      expect(names("EXEC_BOARD"), tool).toContain(tool);
      for (const stage of ["BOARD", "MEMBER", "CANDIDATE", "SPEAKER"] as const) {
        expect(names(stage), `${tool} / ${stage}`).not.toContain(tool);
      }
    }
  });

  /** BOARD gets exactly what a member gets, no more, for now. */
  it("gives a board member the member toolset and nothing beyond it", () => {
    expect(names("BOARD").sort()).toEqual(names("MEMBER").sort());
  });

  it("reserves announce for exec board", () => {
    expect(names("EXEC_BOARD")).toContain("announce");
    expect(names("BOARD")).not.toContain("announce");
    expect(names("MEMBER")).not.toContain("announce");
  });

  it("keeps a guest out of member tooling and vice versa", () => {
    expect(names("CANDIDATE")).not.toContain("rsvp");
    expect(names("MEMBER")).not.toContain("message_board");
  });

  it("gives every stage whoami and nothing unnamed", () => {
    for (const stage of ["CANDIDATE", "SPEAKER", "MEMBER", "BOARD", "EXEC_BOARD"] as const) {
      expect(names(stage)).toContain("whoami");
      expect(names(stage).length).toBeGreaterThan(0);
    }
  });

  it("has no tool that belongs to nobody", () => {
    for (const tool of TOOLS) {
      expect(tool.stages.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("uses unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
