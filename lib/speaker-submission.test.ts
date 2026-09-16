import { describe, it, expect } from "vitest";
import { parseSpeakerSubmission } from "./speaker-submission";

const VALID = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  organization: "Analytical Engines Inc.",
  referredBy: "Nicolas",
  availability: ["2026-10-01T00:00:00.000Z", "2026-10-03T00:00:00.000Z"],
  needs: "Projector",
  publicOptIn: true,
};

describe("parseSpeakerSubmission", () => {
  it("accepts a fully valid submission", () => {
    const result = parseSpeakerSubmission(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Ada Lovelace");
      expect(result.data.availability).toHaveLength(2);
      expect(result.data.publicOptIn).toBe(true);
    }
  });

  it("defaults optional fields when omitted", () => {
    const required = {
      name: VALID.name,
      email: VALID.email,
      referredBy: VALID.referredBy,
      availability: VALID.availability,
    };
    const result = parseSpeakerSubmission(required);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.organization).toBeNull();
      expect(result.data.needs).toBeNull();
      expect(result.data.publicOptIn).toBe(false);
    }
  });

  it("rejects a missing name", () => {
    const result = parseSpeakerSubmission({ ...VALID, name: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = parseSpeakerSubmission({ ...VALID, email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing referredBy", () => {
    const result = parseSpeakerSubmission({ ...VALID, referredBy: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects empty availability", () => {
    const result = parseSpeakerSubmission({ ...VALID, availability: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects an unparseable availability date", () => {
    const result = parseSpeakerSubmission({ ...VALID, availability: ["not-a-date"] });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-string needs", () => {
    const result = parseSpeakerSubmission({ ...VALID, needs: 123 });
    expect(result.ok).toBe(false);
  });
});
