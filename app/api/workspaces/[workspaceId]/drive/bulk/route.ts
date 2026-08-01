import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { bulkDeleteDriveFiles, bulkMoveDriveFiles } from '@/lib/drive-bulk';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// POST /api/workspaces/[id]/drive/bulk  { action: 'move'|'delete', fileIds: string[], folderId?: string|null }
// One request for the multi-select bar's Move/Delete actions, instead of a
// client-side loop of the single-file routes — the full id list is validated
// against this workspace and acted on as one statement, not N independent
// requests a client bug could partially replay.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== 'move' && action !== 'delete') {
      return apiErrors.badRequest('action must be "move" or "delete"');
    }

    const fileIds = Array.isArray(body?.fileIds)
      ? body.fileIds.filter((v: unknown): v is string => typeof v === 'string')
      : [];
    if (fileIds.length === 0) return apiErrors.badRequest('Select at least one file');

    if (action === 'move') {
      const rawFolderId = body?.folderId;
      if (rawFolderId !== null && rawFolderId !== undefined && typeof rawFolderId !== 'string') {
        return apiErrors.badRequest('folderId must be a string or null');
      }
      const result = await bulkMoveDriveFiles(id, fileIds, rawFolderId ?? null);
      if (!result.ok) {
        if (result.reason === 'invalid_folder') {
          return apiErrors.badRequest('folderId does not belong to this workspace');
        }
        if (result.reason === 'too_many_files') {
          return apiErrors.badRequest('Select 500 files or fewer at once');
        }
        return apiErrors.badRequest('Select at least one file');
      }
      return withCacheControl(successResponse({ moved: result.moved }), 'private, no-store');
    }

    const result = await bulkDeleteDriveFiles(id, fileIds);
    if (!result.ok) return apiErrors.badRequest('Select at least one file');
    return withCacheControl(successResponse({ deleted: result.deleted }), 'private, no-store');
  } catch (error) {
    logError('Failed to run a bulk drive action:', error);
    return apiErrors.internalError('Failed to run the bulk action');
  }
}
