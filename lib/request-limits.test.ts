import { describe, expect, it } from "vitest";
import { MAX_FORM_DATA_BYTES, MAX_POST_CHARACTERS, validateFormData, validatePostBody } from "./request-limits";

describe("request limits", () => {
  it("enforces the post limit after trimming", () => {
    expect(validatePostBody(`  ${"x".repeat(MAX_POST_CHARACTERS)}  `).ok).toBe(true);
    const result = validatePostBody(` ${"x".repeat(MAX_POST_CHARACTERS + 1)} `);
    expect(result).toEqual({ ok: false, error: "Posts are limited to 5,000 characters." });
  });

  it("rejects arrays and non-plain form answer objects", () => {
    expect(validateFormData([]).ok).toBe(false);
    expect(validateFormData(new Date()).ok).toBe(false);
  });

  it("caps serialized form answers at 50 KB", () => {
    expect(validateFormData({ answer: "x".repeat(MAX_FORM_DATA_BYTES) })).toEqual({
      ok: false,
      error: "Form answers are limited to 50 KB.",
    });
  });
});
