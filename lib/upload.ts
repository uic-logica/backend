/**
 * Shared base64-JSON file upload parsing (`{ filename, mimeType, data }`,
 * `data` base64-encoded). ponytail: no multipart/form-data parsing — every
 * other POST body in this app is already JSON, and a base64 string in JSON
 * is a one-line decode versus pulling in a form-data parser for one route.
 * ~33% wire overhead on the upload only; fine at PDF/slide-deck sizes.
 */
export type ParsedUpload = { filename: string; mimeType: string; data: Uint8Array<ArrayBuffer> };

export type UploadKind = "pdf" | "docx" | "doc" | "pptx" | "ppt" | "png" | "jpeg";

const TYPES: Record<UploadKind, { extensions: string[]; normalizedMimeType: string }> = {
  pdf: { extensions: [".pdf"], normalizedMimeType: "application/pdf" },
  docx: {
    extensions: [".docx"],
   
    normalizedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  doc: { extensions: [".doc"], normalizedMimeType: "application/msword" },
  pptx: {
    extensions: [".pptx"],
   
    normalizedMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  ppt: { extensions: [".ppt"], normalizedMimeType: "application/vnd.ms-powerpoint" },
  png: { extensions: [".png"], normalizedMimeType: "image/png" },
  jpeg: { extensions: [".jpg", ".jpeg"], normalizedMimeType: "image/jpeg" },
};

function hasPrefix(data: Buffer, prefix: number[] | string): boolean {
  const expected = typeof prefix === "string" ? Buffer.from(prefix, "ascii") : Buffer.from(prefix);
  return data.length >= expected.length && data.subarray(0, expected.length).equals(expected);
}

function hasSignature(kind: UploadKind, data: Buffer): boolean {
  if (kind === "pdf") return hasPrefix(data, "%PDF-");
  if (kind === "png") return hasPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (kind === "jpeg") return hasPrefix(data, [0xff, 0xd8, 0xff]);
  if (kind === "doc" || kind === "ppt") return hasPrefix(data, [0xd0, 0xcf, 0x11, 0xe0]);
  return hasPrefix(data, [0x50, 0x4b, 0x03, 0x04]);
}

export function parseUpload(
  payload: unknown,
  maxBytes: number,
  allowedKinds: readonly UploadKind[],
): { ok: true; upload: ParsedUpload } | { ok: false; error: string } {
  const { filename, mimeType, data } = (payload ?? {}) as Record<string, unknown>;

  if (typeof filename !== "string" || filename.trim().length === 0) {
    return { ok: false, error: "`filename` is required." };
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(filename)) {
    return { ok: false, error: "`filename` cannot contain control characters." };
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

  const normalizedFilename = filename.trim();
  // Extension + magic bytes decide the type; the browser's claimed MIME is ignored because
  // it's unreliable (e.g. .docx arrives as application/octet-stream on machines without Office).
  const kind = allowedKinds.find((candidate) =>
    TYPES[candidate].extensions.some((extension) => normalizedFilename.toLowerCase().endsWith(extension))
    && hasSignature(candidate, buffer),
  );
  if (!kind) {
    return { ok: false, error: "File type is not allowed or does not match its contents." };
  }

  // Prisma's Bytes fields want a plain Uint8Array<ArrayBuffer>. Buffer (and
  // even Uint8Array.from(buffer)) type as Uint8Array<ArrayBufferLike> since
  // they may share a SharedArrayBuffer-backed view — an explicit fresh
  // ArrayBuffer sidesteps that.
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length));
  bytes.set(buffer);

  return { ok: true, upload: { filename: normalizedFilename, mimeType: TYPES[kind].normalizedMimeType, data: bytes } };
}
