import { NextRequest, NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { driveConfigured, uploadReceipt } from "@/lib/drive";

// Vercel caps a request at 4.5 MB; the dashboard shrinks photos well under this first.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * Exec only: save a receipt (photo or PDF) to the club Drive under
 * Receipts/<YYYY-MM>, and return its link for the Money entry. Reading the
 * receipt happens in the browser; this only stores it.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;
  if (!driveConfigured()) {
    return NextResponse.json({ error: "Google Drive isn't connected yet, so the receipt can't be saved. Add the Drive settings in Vercel." }, { status: 503 });
  }
  let file: File | null = null;
  try {
    const value = (await request.formData()).get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "Send the receipt as a file." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Send the receipt as a file." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Receipts can be a photo (JPG, PNG, WebP) or a PDF." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is over 4 MB. Try a smaller photo." }, { status: 413 });

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
  const base = (file.name.replace(/\.[^.]+$/, "") || "receipt").replace(/[^\w .-]+/g, "").slice(0, 60) || "receipt";
  try {
    const saved = await uploadReceipt({ name: `${stamp} ${base}.${ext}`, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
