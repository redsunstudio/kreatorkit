import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { driveFolderDTO, sanitizeFolderName } from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string; folderId: string }> };

// PATCH /api/workspaces/[id]/drive/folders/[folderId]  { name }
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { workspaceId: id, folderId } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!rawName) return apiErrors.badRequest('name is required');
    const name = sanitizeFolderName(rawName);

    const folder = await db.workspaceUploadFolder.findFirst({
      where: { id: folderId, workspaceId: id },
      select: { id: true },
    });
    if (!folder) return apiErrors.notFound('Folder');

    const updated = await db.workspaceUploadFolder.update({
      where: { id: folder.id },
      data: { name },
      select: { id: true, name: true, createdAt: true, _count: { select: { uploads: true } } },
    });

    const response = successResponse({ folder: driveFolderDTO(updated) });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to rename a drive folder:', error);
    return apiErrors.internalError('Failed to rename the folder');
  }
}

// DELETE /api/workspaces/[id]/drive/folders/[folderId]
// Removes ONLY the folder row. Files inside fall back to the unsorted root
// (folderId FK is SET NULL) — this must never touch storage/R2, a folder
// delete is purely organizational.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { workspaceId: id, folderId } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const folder = await db.workspaceUploadFolder.findFirst({
      where: { id: folderId, workspaceId: id },
      select: { id: true },
    });
    if (!folder) return apiErrors.notFound('Folder');

    await db.workspaceUploadFolder.delete({ where: { id: folder.id } });

    const response = successResponse({ message: 'Folder deleted' });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to delete a drive folder:', error);
    return apiErrors.internalError('Failed to delete the folder');
  }
}
