import { NextRequest } from 'next/server';
import { auth, checkProjectAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { cleanupVideoStorage } from '@/lib/video-cleanup';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ projectId: string; videoId: string }>;
}

// POST /api/projects/[projectId]/videos/[videoId]/archive
// Storage housekeeping for a finished item — see lib/video-cleanup.ts.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { projectId, videoId } = await params;
    if (!session?.user?.id) return apiErrors.unauthorized();

    const video = await db.video.findFirst({
      where: { id: videoId, projectId },
      include: { project: true },
    });
    if (!video) return apiErrors.notFound('Video');

    const access = await checkProjectAccess(video.project, session.user.id, { intent: 'manage' });
    if (!access.canEdit) return apiErrors.forbidden('Access denied');

    const result = await cleanupVideoStorage(videoId);
    if (!result.ok) {
      return result.error === 'not_found'
        ? apiErrors.notFound('Video')
        : apiErrors.badRequest('Only published, archived or rejected videos can be cleaned up');
    }

    const response = successResponse({
      ok: true,
      assetsCleared: result.assetsCleared,
      versionsCleared: result.versionsCleared,
      keptVersion: result.keptVersion,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error archiving video:', error);
    return apiErrors.internalError('Failed to archive the video');
  }
}
