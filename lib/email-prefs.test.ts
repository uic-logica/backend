import { describe, expect, it } from "vitest";
import { categoriesFor, modeFor, modesFor } from "./email-prefs";

const exec = { accountKind: "MEMBER", role: "EXEC_BOARD" };
const member = { accountKind: "MEMBER", role: "MEMBER" };
const guest = { accountKind: "SPEAKER", role: "MEMBER" };

describe("email modes", () => {
  it("execs get conversations right away and the rest in the 9 AM summary, until they change it", () => {
    expect(modeFor(exec, null, "guestReplies")).toBe("INSTANT");
    expect(modeFor(exec, null, "memberMessages")).toBe("INSTANT");
    expect(modeFor(exec, {}, "boardUpdates")).toBe("SUMMARY");
    expect(modeFor(exec, {}, "events")).toBe("SUMMARY");
    expect(modeFor(exec, { boardUpdates: "OFF", events: "INSTANT" }, "boardUpdates")).toBe("OFF");
    expect(modeFor(exec, { boardUpdates: "OFF", events: "INSTANT" }, "events")).toBe("INSTANT");
  });

  it("only the exec board has a summary; a leftover summary choice just sends", () => {
    expect(modesFor(exec)).toEqual(["INSTANT", "SUMMARY", "OFF"]);
    expect(modesFor(member)).toEqual(["INSTANT", "OFF"]);
    expect(modeFor(member, null, "events")).toBe("INSTANT");
    expect(modeFor(member, { events: "SUMMARY" }, "events")).toBe("INSTANT");
    expect(modeFor(member, { events: "OFF" }, "events")).toBe("OFF");
  });

  it("decisions always email, whatever was saved", () => {
    expect(modeFor(member, { decisions: "OFF" }, "decisions")).toBe("INSTANT");
    expect(modeFor(exec, { decisions: "SUMMARY" }, "decisions")).toBe("INSTANT");
  });

  it("shows each person only their own categories", () => {
    const keys = (u: object) => categoriesFor(u).map((c) => c.key);
    expect(keys(guest)).toEqual(["messages"]);
    expect(keys(member)).toEqual(["messages", "events", "announcements"]);
    expect(keys(exec)).toEqual(["messages", "events", "announcements", "guestReplies", "memberMessages", "boardUpdates"]);
  });
});
