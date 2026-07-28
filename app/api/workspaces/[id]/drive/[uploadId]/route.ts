import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { createPresignedFileGetUrl, deleteR2Object } from '@/lib/r2';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ id: string; uploadId: string }> };

// GET /api/workspaces/[id]/drive/[uploadId] — 302 to a presigned download.
// Never pipe the bytes through the app: raw footage is multi-GB and proxying it
// is what OOM'd the platform on 2026-07-13.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'asset-download');
    if (limited) return limited;

    const { id, uploadId } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const file = await db.workspaceUpload.findFirst({
      where: { id: uploadId, workspaceId: id },
      select: { objectKey: true, displayName: true },
    });
    if (!file) return apiErrors.notFound('File');

    const url = await createPresignedFileGetUrl(file.objectKey, file.displayName);
    return NextResponse.redirect(url, 302);
  } catch (error) {
    logError('Failed to serve a drive file:', error);
    return apiErrors.internalError('Failed to download the file');
  }
}

// DELETE /api/workspaces/[id]/drive/[uploadId] — drops the row AND the object.
// The drive row owns the bytes until the file is assigned to an item, so this is
// the one place a delete is safe without checking for other references.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { id, uploadId } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const file = await db.workspaceUpload.findFirst({
      where: { id: uploadId, workspaceId: id },
      select: { id: true, objectKey: true },
    });
    if (!file) return apiErrors.notFound('File');

    await db.workspaceUpload.delete({ where: { id: file.id } });
    await deleteR2Object(file.objectKey).catch((error) => {
      // The row is gone either way; a stray object is swept by the nightly job.
      logError('Drive object delete failed after row removal:', error);
    });

    return withCacheControl(successResponse({ ok: true, id: uploadId }), 'private, no-store');
  } catch (error) {
    logError('Failed to delete a drive file:', error);
    return apiErrors.internalError('Failed to delete the file');
  }
}
