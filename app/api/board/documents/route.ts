import { NextRequest, NextResponse } from "next/server";
import { requireBoard } from "@/lib/board-guard";
import { driveConfigured, listFolder, rootFolderId, searchFiles } from "@/lib/drive";

/**
 * The club's Drive, browsable from inside the dashboard. Board+ only — the
 * shared folder has budgets and contracts in it.
 *
 * Returns `{ configured: false }` rather than erroring when the service
 * account isn't set up, so the Documents tab ships and explains itself
 * instead of showing a red box.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBoard();
  if (gate.error) return gate.error;

  if (!driveConfigured()) {
    return NextResponse.json({ configured: false, files: [], root: null });
  }

  const params = request.nextUrl.searchParams;
  const search = params.get("q")?.trim();
  const folder = params.get("folder")?.trim();

  try {
    const files = search ? await searchFiles(search) : await listFolder(folder);
    return NextResponse.json({
      configured: true,
      root: rootFolderId(),
      folder: search ? null : folder || rootFolderId(),
      searching: search ?? null,
      files,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
