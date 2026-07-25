import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { cleanupVideoStorage } from '@/lib/video-cleanup';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST /api/agent/videos/[videoId]/cleanup
// Agent rail for storage housekeeping (kk.py cleanup) — same behaviour as the
// session archive endpoint: old cut files + assets go, the kept cut, its
// comments, the brief and the thumbnail stay, the status is untouched.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

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
    logError('Agent cleanup failed:', error);
    return apiErrors.internalError('Failed to clean up the video');
  }
}
