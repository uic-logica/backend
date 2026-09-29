import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isStatus, parseApplication } from "./membership-application";

const VALID = {
  name: "Ada Lovelace",
  email: "Ada@UIC.edu",
  track: "SOFTWARE_ENGINEER",
  major: "CS",
  gradYear: 2028,
  why: "I want to learn.",
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

  it("treats major and grad year as optional", () => {
    const result = parseApplication({ ...VALID, major: undefined, gradYear: undefined });
    expect(result.ok && result.data.major === null && result.data.gradYear === null).toBe(true);
  });

  it("rejects a non-UIC email", () => {
    expect(parseApplication({ ...VALID, email: "ada@gmail.com" }).ok).toBe(false);
  });

  it("rejects an unknown track", () => {
    expect(parseApplication({ ...VALID, track: "CEO" }).ok).toBe(false);
  });

  it("requires a name and a why", () => {
    expect(parseApplication({ ...VALID, name: " " }).ok).toBe(false);
    expect(parseApplication({ ...VALID, why: "" }).ok).toBe(false);
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
  const base = { name: "Ada", email: "ada@uic.edu", track: "SOFTWARE_ENGINEER", why: "Build.", github: "ada", hoursPerWeek: 4, projects: ["RESUME_BUILDER"] };
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
  const base = { name: "Ada", email: "ada@uic.edu", why: "", github: "ada", hoursPerWeek: 4, projects: ["RESUME_BUILDER"] };
  it("is optional for build teams", () => {
    const result = parseApplication({ ...base, track: "SOFTWARE_ENGINEER" });
    expect(result.ok && result.data.why).toBe("");
  });
  it("is still required for the board track", () => {
    expect(parseApplication({ ...base, track: "BOARD_MEMBER" }).ok).toBe(false);
  });
});
