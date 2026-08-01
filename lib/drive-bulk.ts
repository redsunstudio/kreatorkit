import { db } from '@/lib/db';
import { deleteR2Object } from '@/lib/r2';
import { logError } from '@/lib/logger';
import { DRIVE_NEW_VIDEO_MAX_FILES } from '@/lib/drive-assign';

export type BulkMoveResult =
  | { ok: true; moved: number }
  | { ok: false; reason: 'no_files' | 'too_many_files' | 'invalid_folder' };

/**
 * Move a batch of already-uploaded Drive files into a folder (or back to
 * unsorted). Ids are scoped to `workspaceId` in the query itself, so an id
 * from another workspace is silently dropped rather than acted on.
 */
export async function bulkMoveDriveFiles(
  workspaceId: string,
  fileIds: string[],
  folderId: string | null
): Promise<BulkMoveResult> {
  const ids = Array.from(new Set(fileIds));
  if (ids.length === 0) return { ok: false, reason: 'no_files' };
  if (ids.length > DRIVE_NEW_VIDEO_MAX_FILES) return { ok: false, reason: 'too_many_files' };

  let resolvedFolderId: string | null = null;
  if (folderId) {
    const folder = await db.workspaceUploadFolder.findFirst({
      where: { id: folderId, workspaceId },
      select: { id: true },
    });
    if (!folder) return { ok: false, reason: 'invalid_folder' };
    resolvedFolderId = folder.id;
  }

  const { count } = await db.workspaceUpload.updateMany({
    where: { id: { in: ids }, workspaceId },
    data: { folderId: resolvedFolderId },
  });

  return { ok: true, moved: count };
}

export type BulkDeleteResult = { ok: true; deleted: number } | { ok: false; reason: 'no_files' };

/**
 * Delete a batch of already-uploaded Drive files — the row AND the object.
 * Same "row gone either way, nightly sweep catches stragglers" convention the
 * single-file DELETE route uses: R2 cleanup is best-effort and never blocks
 * or reverts the DB deletion.
 */
export async function bulkDeleteDriveFiles(
  workspaceId: string,
  fileIds: string[]
): Promise<BulkDeleteResult> {
  const ids = Array.from(new Set(fileIds));
  if (ids.length === 0) return { ok: false, reason: 'no_files' };

  // Scoped to workspaceId here, before anything is deleted — an id from
  // another workspace never reaches the delete statement at all.
  const files = await db.workspaceUpload.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true, objectKey: true },
  });
  if (files.length === 0) return { ok: true, deleted: 0 };

  await db.workspaceUpload.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });

  const cleanup = await Promise.allSettled(files.map((f) => deleteR2Object(f.objectKey)));
  cleanup.forEach((result, i) => {
    if (result.status === 'rejected') {
      logError(
        `Drive object delete failed after bulk row removal (${files[i].objectKey}):`,
        result.reason
      );
    }
  });

  return { ok: true, deleted: files.length };
}
