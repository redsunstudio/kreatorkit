import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { publishVideoToYouTube, PublishError, type PublishMode } from '@/lib/publish-video';
import { publishPostToLinkedIn } from '@/lib/publish-post';
import { db } from '@/lib/db';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST /api/agent/videos/[videoId]/publish { mode?: 'studio'|'draft'|'live', publishNow?: boolean }
// Automation rail: draft = park in Zernio; studio = private video in the
// client's YouTube Studio; live = straight out + auto-PUBLISHED.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const body = await request.json().catch(() => null);

    const item = await db.video.findUnique({ where: { id: videoId }, select: { videoType: true } });
    if (item?.videoType === 'POST') {
      const result = await publishPostToLinkedIn(videoId, {
        mode: body?.mode === 'live' ? 'live' : body?.mode === 'queue' ? 'queue' : 'draft',
        scheduledFor: typeof body?.scheduledFor === 'string' ? body.scheduledFor : undefined,
        force: body?.force === true,
        actorName: 'Agency OS',
      });
      return withCacheControl(successResponse(result), 'private, no-store');
    }

    const mode: PublishMode = ['studio', 'draft', 'live'].includes(body?.mode)
      ? body.mode
      : body?.publishNow === true
        ? 'live'
        : 'draft';
    const result = await publishVideoToYouTube(videoId, {
      mode,
      force: body?.force === true,
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
