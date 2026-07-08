import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { publishVideoToYouTube, PublishError } from '@/lib/publish-video';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST /api/agent/videos/[videoId]/publish { publishNow?: boolean }
// Automation rail: approved video -> Zernio YouTube draft (or straight publish).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const body = await request.json().catch(() => null);
    const result = await publishVideoToYouTube(videoId, {
      publishNow: body?.publishNow === true,
      actorName: 'Agency OS',
    });
    return withCacheControl(successResponse(result), 'private, no-store');
  } catch (error) {
    if (error instanceof PublishError) {
      return error.statusCode === 404
        ? apiErrors.notFound('Video')
        : apiErrors.badRequest(error.message);
    }
    logError('agent publish failed:', error);
    return apiErrors.internalError('Publishing failed');
  }
}
