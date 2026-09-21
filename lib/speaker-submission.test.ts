import { describe, it, expect } from "vitest";
import { parseSpeakerFields, parseFreshSubmission, parseCompletion } from "./speaker-submission";

const WINDOW = { startDate: "2026-10-01", endDate: "2026-10-03", startTime: "14:00", endTime: "16:00" };

const FULL = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  organization: "Analytical Engines Inc.",
  referredBy: "Nicolas",
  availability: [WINDOW],
  needs: "Projector",
  publicOptIn: true,
};

describe("parseSpeakerFields", () => {
  it("accepts a fully populated payload", () => {
    const result = parseSpeakerFields(FULL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Ada Lovelace");
      expect(result.data.availability).toEqual([WINDOW]);
      expect(result.data.publicOptIn).toBe(true);
    }
  });

  it("accepts an empty payload — every field is optional here", () => {
    const result = parseSpeakerFields({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({});
  });

  it("accepts a partial payload with just one field", () => {
    const result = parseSpeakerFields({ email: "ada@example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ email: "ada@example.com" });
  });

  it("rejects a blank name when present", () => {
    expect(parseSpeakerFields({ name: "  " }).ok).toBe(false);
  });

  it("rejects an invalid email when present", () => {
    expect(parseSpeakerFields({ email: "not-an-email" }).ok).toBe(false);
  });

  it("rejects an availability window with a bad date", () => {
    expect(parseSpeakerFields({ availability: [{ ...WINDOW, startDate: "Oct 1" }] }).ok).toBe(false);
  });

  it("rejects an availability window with a bad time", () => {
    expect(parseSpeakerFields({ availability: [{ ...WINDOW, startTime: "2pm" }] }).ok).toBe(false);
  });

  it("rejects an availability window where endDate is before startDate", () => {
    expect(
      parseSpeakerFields({ availability: [{ ...WINDOW, startDate: "2026-10-05", endDate: "2026-10-01" }] }).ok,
    ).toBe(false);
  });

  it("rejects a non-string needs", () => {
    expect(parseSpeakerFields({ needs: 123 }).ok).toBe(false);
  });

  it("accepts a note — shared field, either side can set it", () => {
    const result = parseSpeakerFields({ note: "can't make Wednesday, Thursday works" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.note).toBe("can't make Wednesday, Thursday works");
  });
});

describe("parseFreshSubmission", () => {
  it("requires a name", () => {
    const result = parseFreshSubmission({ email: "ada@example.com" });
    expect(result.ok).toBe(false);
  });

  it("requires an email", () => {
    const result = parseFreshSubmission({ name: "Ada" });
    expect(result.ok).toBe(false);
  });

  it("accepts a payload with both name and email", () => {
    const result = parseFreshSubmission({ name: "Ada", email: "ada@example.com" });
    expect(result.ok).toBe(true);
  });

  it("keeps note — it's a shared field now, not board-only", () => {
    const result = parseFreshSubmission({ name: "Ada", email: "ada@example.com", note: "hello" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.note).toBe("hello");
  });
});

describe("parseCompletion", () => {
  it("rejects a payload with no name when the draft has none either", () => {
    const result = parseCompletion({ email: "ada@example.com" }, null, null);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with no email when the draft has none either", () => {
    const result = parseCompletion({ name: "Ada" }, null, null);
    expect(result.ok).toBe(false);
  });

  it("accepts a payload with no name when the draft already has one", () => {
    const result = parseCompletion({ email: "ada@example.com" }, "Ada Lovelace", null);
    expect(result.ok).toBe(true);
  });

  it("accepts a payload with no email when the draft already has one", () => {
    const result = parseCompletion({ name: "Ada" }, null, "ada@example.com");
    expect(result.ok).toBe(true);
  });

  it("accepts a payload that supplies its own name and email", () => {
    const result = parseCompletion({ name: "Ada", email: "ada@example.com" }, null, null);
    expect(result.ok).toBe(true);
  });
});

describe("parseSpeakerFields — talk", () => {
  it("accepts a talk title and an https slides link", () => {
    const result = parseSpeakerFields({
      talkTitle: "  Shipping real systems  ",
      slidesUrl: "https://docs.google.com/presentation/d/abc/edit",
    });
    expect(result).toEqual({
      ok: true,
      data: {
        talkTitle: "Shipping real systems",
        slidesUrl: "https://docs.google.com/presentation/d/abc/edit",
      },
    });
  });

  it("lets an empty slides link clear the field", () => {
    const result = parseSpeakerFields({ slidesUrl: "   " });
    expect(result).toEqual({ ok: true, data: { slidesUrl: "" } });
  });

  // This value ends up in an href, so a non-http scheme must never survive.
  it.each(["javascript:alert(1)", "data:text/html,<script>", "slides.com/deck"])(
    "rejects %s as a slides link",
    (slidesUrl) => {
      expect(parseSpeakerFields({ slidesUrl }).ok).toBe(false);
    },
  );

  it("rejects a talk title longer than 200 characters", () => {
    expect(parseSpeakerFields({ talkTitle: "x".repeat(201) }).ok).toBe(false);
  });
});
