/**
 * Shared base64-JSON file upload parsing (`{ filename, mimeType, data }`,
 * `data` base64-encoded). ponytail: no multipart/form-data parsing — every
 * other POST body in this app is already JSON, and a base64 string in JSON
 * is a one-line decode versus pulling in a form-data parser for one route.
 * ~33% wire overhead on the upload only; fine at PDF/slide-deck sizes.
 */
export type ParsedUpload = { filename: string; mimeType: string; data: Uint8Array<ArrayBuffer> };

export function parseUpload(payload: unknown, maxBytes: number): { ok: true; upload: ParsedUpload } | { ok: false; error: string } {
  const { filename, mimeType, data } = (payload ?? {}) as Record<string, unknown>;

  if (typeof filename !== "string" || filename.trim().length === 0) {
    return { ok: false, error: "`filename` is required." };
  }
  if (typeof mimeType !== "string" || mimeType.trim().length === 0) {
    return { ok: false, error: "`mimeType` is required." };
  }
  if (typeof data !== "string" || data.length === 0) {
    return { ok: false, error: "`data` (base64) is required." };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(data, "base64");
  } catch {
    return { ok: false, error: "`data` must be valid base64." };
  }
  if (buffer.length === 0) {
    return { ok: false, error: "`data` decoded to an empty file." };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, error: `File too large — max ${Math.floor(maxBytes / (1024 * 1024))}MB.` };
  }

  // Prisma's Bytes fields want a plain Uint8Array<ArrayBuffer>. Buffer (and
  // even Uint8Array.from(buffer)) type as Uint8Array<ArrayBufferLike> since
  // they may share a SharedArrayBuffer-backed view — an explicit fresh
  // ArrayBuffer sidesteps that.
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length));
  bytes.set(buffer);

  return { ok: true, upload: { filename: filename.trim(), mimeType: mimeType.trim(), data: bytes } };
}
