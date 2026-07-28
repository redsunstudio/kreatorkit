import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { driveFileDTO } from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// GET /api/workspaces/[id]/drive — everything waiting to be sorted onto items.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'asset-list');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const files = await db.workspaceUpload.findMany({
      where: { workspaceId: id },
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
      },
    });

    const response = successResponse({ files: files.map(driveFileDTO) });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to list the workspace drive:', error);
    return apiErrors.internalError('Failed to load the drive');
  }
}
