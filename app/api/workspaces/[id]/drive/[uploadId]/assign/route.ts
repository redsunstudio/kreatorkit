import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { assignDriveFileToVideo } from '@/lib/drive-assign';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ id: string; uploadId: string }> };

// POST /api/workspaces/[id]/drive/[uploadId]/assign  { videoId }
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { id, uploadId } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);
    const videoId = typeof body?.videoId === 'string' ? body.videoId.trim() : '';
    if (!videoId) return apiErrors.badRequest('videoId is required');

    const session = await auth();
    const result = await assignDriveFileToVideo(id, uploadId, videoId, {
      userId: access.userId,
      name: session?.user?.name ?? null,
    });
    if (!result.ok) {
      return result.reason === 'file_not_found'
        ? apiErrors.notFound('File')
        : apiErrors.notFound('Video');
    }

    return withCacheControl(
      successResponse({ ok: true, assetId: result.assetId, videoTitle: result.videoTitle }),
      'private, no-store'
    );
  } catch (error) {
    logError('Failed to assign a drive file:', error);
    return apiErrors.internalError('Failed to move the file onto the item');
  }
}
