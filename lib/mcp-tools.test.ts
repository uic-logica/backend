import { describe, expect, it } from "vitest";
import { TOOLS, toolSummary } from "./mcp-tools";
import type { Stage } from "./stage";

const STAGES: Stage[] = ["CANDIDATE", "SPEAKER", "MEMBER", "BOARD", "EXEC_BOARD"];

describe("toolSummary", () => {
  it.each(STAGES)("shows %s only its own tools, in plain words", (stage) => {
    const own = TOOLS.filter((t) => t.stages.includes(stage)).map((t) => t.summary);
    const others = TOOLS.filter((t) => !t.stages.includes(stage)).map((t) => t.summary);
    const shown = toolSummary(stage);
    expect(shown).toEqual(own);
    for (const line of shown) {
      expect(others).not.toContain(line);
      expect(line).not.toMatch(/_/); // never a tool name
    }
  });

  it("gives every tool a distinct line", () => {
    const lines = TOOLS.map((t) => t.summary);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
