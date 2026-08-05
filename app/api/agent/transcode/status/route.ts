import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isTranscodeWorkerRequest } from '@/lib/transcode-auth';
import { logError } from '@/lib/logger';

// GET /api/agent/transcode/status[?videoId=...]
//
// Queue health at a glance: how many rungs are waiting, running, done, skipped
// or failed, plus the last few failures with their reason. Per-item when a
// videoId is given — "why has this cut got no 1080 option yet".
export async function GET(request: NextRequest) {
  try {
    if (!isTranscodeWorkerRequest(request)) {
      return apiErrors.unauthorized();
    }

    const videoId = request.nextUrl.searchParams.get('videoId');
    const where = videoId ? { version: { videoParentId: videoId } } : {};

    const [grouped, failures] = await Promise.all([
      db.videoProxy.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.videoProxy.findMany({
        where: { ...where, status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          height: true,
          attempts: true,
          error: true,
          version: { select: { id: true, video: { select: { id: true, title: true } } } },
        },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.status] = row._count._all;

    const response = successResponse({
      videoId,
      counts,
      failures: failures.map((failure) => ({
        proxyId: failure.id,
        videoId: failure.version.video.id,
        title: failure.version.video.title,
        height: failure.height,
        attempts: failure.attempts,
        error: failure.error,
      })),
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error reading transcode status:', error);
    return apiErrors.internalError('Failed to read the transcode queue');
  }
}
