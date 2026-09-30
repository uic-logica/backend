export const MAX_POST_CHARACTERS = 5_000;
export const MAX_FORM_DATA_BYTES = 50 * 1024;

export function validatePostBody(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof body !== "string" || body.trim().length === 0) return { ok: false, error: "`body` is required." };
  const trimmed = body.trim();
  if (trimmed.length > MAX_POST_CHARACTERS) {
    return { ok: false, error: `Posts are limited to ${MAX_POST_CHARACTERS.toLocaleString("en-US")} characters.` };
  }
  return { ok: true, body: trimmed };
}

export function validateFormData(data: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) {
    return { ok: false, error: "`data` must be a plain object." };
  }
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_FORM_DATA_BYTES) {
    return { ok: false, error: "Form answers are limited to 50 KB." };
  }
  return { ok: true, data: data as Record<string, unknown> };
}
