import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isStatus, parseApplication, reapplyBlock } from "./membership-application";

const VALID = {
  name: "Ada Lovelace",
  email: "Ada@UIC.edu",
  track: "SOFTWARE_ENGINEER",
  major: "CS",
  gradYear: 2028,
  why: "I want to learn by shipping real features with the team.",
  github: "ada",
  hoursPerWeek: 10,
  projects: ["OPPORTUNITY_BOARD"],
  skills: "TypeScript",
};

describe("parseApplication", () => {
  const original = process.env.ALLOWED_EMAIL_DOMAIN;
  beforeEach(() => {
    process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu";
  });
  afterEach(() => {
    process.env.ALLOWED_EMAIL_DOMAIN = original;
  });

  it("accepts a full application and lowercases the email", () => {
    const result = parseApplication(VALID);
    expect(result).toEqual({ ok: true, data: { ...VALID, email: "ada@uic.edu", resumeUrl: null } });
  });

  it("requires major, grad year and skills", () => {
    expect(parseApplication({ ...VALID, major: undefined }).ok).toBe(false);
    expect(parseApplication({ ...VALID, gradYear: undefined }).ok).toBe(false);
    expect(parseApplication({ ...VALID, skills: " " }).ok).toBe(false);
  });

  it("rejects a non-UIC email", () => {
    expect(parseApplication({ ...VALID, email: "ada@gmail.com" }).ok).toBe(false);
  });

  it("rejects an unknown track", () => {
    expect(parseApplication({ ...VALID, track: "CEO" }).ok).toBe(false);
  });

  it("requires a name, and a why on the board track", () => {
    expect(parseApplication({ ...VALID, name: " " }).ok).toBe(false);
    expect(parseApplication({ ...VALID, track: "BOARD_MEMBER", why: "" }).ok).toBe(false);
  });

  it("rejects an oversized why and a bad grad year", () => {
    expect(parseApplication({ ...VALID, why: "x".repeat(2001) }).ok).toBe(false);
    expect(parseApplication({ ...VALID, gradYear: "2028" }).ok).toBe(false);
  });
});

describe("isStatus", () => {
  it("only accepts known statuses", () => {
    expect(isStatus("INTERVIEW")).toBe(true);
    expect(isStatus("APPROVED")).toBe(false);
  });
});

describe("resumeUrl", () => {
  const base = { ...VALID, email: "ada@uic.edu" };
  it("accepts an https link and treats blank as none", () => {
    const withLink = parseApplication({ ...base, resumeUrl: "https://example.com/cv.pdf" });
    expect(withLink.ok && withLink.data.track === "SOFTWARE_ENGINEER" && withLink.data.resumeUrl).toBe("https://example.com/cv.pdf");
    const blank = parseApplication({ ...base, resumeUrl: "  " });
    expect(blank.ok && blank.data.track === "SOFTWARE_ENGINEER" && blank.data.resumeUrl).toBe(null);
  });
  it.each(["javascript:alert(1)", "http://example.com/cv.pdf", "not a link"])("rejects %s", (resumeUrl) => {
    expect(parseApplication({ ...base, resumeUrl }).ok).toBe(false);
  });
});

describe("why", () => {
  // The board track checks ALLOWED_EMAIL_DOMAIN.
  beforeEach(() => { process.env.ALLOWED_EMAIL_DOMAIN = "uic.edu"; });
  it("needs 40 characters on both tracks", () => {
    for (const track of ["SOFTWARE_ENGINEER", "BOARD_MEMBER"]) {
      expect(parseApplication({ ...VALID, track, why: "Short." }).ok).toBe(false);
      expect(parseApplication({ ...VALID, track, why: "x".repeat(40) }).ok).toBe(true);
    }
  });
});

describe("reapplyBlock", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const row = (status: string, extra = {}) => ({ status, canReapply: true, decidedAt: null, createdAt: new Date("2026-09-01T00:00:00Z"), ...extra }) as never;

  it("lets a first-time applicant through", () => expect(reapplyBlock([], now)).toBeNull());
  it.each(["PENDING", "INTERVIEW", "NEEDS_INFO", "ACCEPTED"])("blocks while one is %s", (status) => {
    expect(reapplyBlock([row(status)], now)).not.toBeNull();
  });
  it("blocks a final decline", () => {
    expect(reapplyBlock([row("DECLINED", { canReapply: false })], now)).toBe("You can't reapply for this role.");
  });
  it("waits 90 days after a decline", () => {
    const declined = row("DECLINED", { decidedAt: new Date("2026-09-15T00:00:00Z") });
    expect(reapplyBlock([declined], now)).toBe("You can reapply for this role from 2026-12-14.");
    expect(reapplyBlock([declined], new Date("2026-12-15T00:00:00Z"))).toBeNull();
  });
});
