const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

export function attachmentContentDisposition(filename: string | null | undefined): string {
  const cleaned = (filename ?? "").replace(CONTROL_CHARACTERS, "").replace(/["\\]/g, "").trim() || "download";
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_") || "download";
  const encoded = encodeURIComponent(cleaned).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
