import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isStatus, parseApplication } from "./membership-application";

const VALID = {
  name: "Ada Lovelace",
  email: "Ada@UIC.edu",
  track: "SOFTWARE_ENGINEER",
  major: "CS",
  gradYear: 2028,
  why: "I want to learn.",
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
    expect(result).toEqual({ ok: true, data: { ...VALID, email: "ada@uic.edu" } });
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
