import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { driveFileDTO, driveFolderDTO } from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// GET /api/workspaces/[id]/drive?folderId= — everything waiting to be sorted
// onto items. Omit folderId for the root view (unsorted files + folder list);
// pass it to see just that folder's files.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'asset-list');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const folderId = request.nextUrl.searchParams.get('folderId');

    const [files, folders] = await Promise.all([
      db.workspaceUpload.findMany({
        where: { workspaceId: id, folderId: folderId ?? null },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          displayName: true,
          contentType: true,
          sizeBytes: true,
          uploaderName: true,
          createdAt: true,
          link: { select: { label: true } },
          folder: { select: { id: true, name: true } },
        },
      }),
      folderId
        ? Promise.resolve([])
        : db.workspaceUploadFolder.findMany({
            where: { workspaceId: id },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              createdAt: true,
              _count: { select: { uploads: true } },
            },
          }),
    ]);

    const response = successResponse({
      files: files.map(driveFileDTO),
      folders: folders.map(driveFolderDTO),
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to list the workspace drive:', error);
    return apiErrors.internalError('Failed to load the drive');
  }
}
