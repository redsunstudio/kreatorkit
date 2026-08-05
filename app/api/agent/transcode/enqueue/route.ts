import { NextRequest } from 'next/server';
import { VideoStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isTranscodeWorkerRequest } from '@/lib/transcode-auth';
import { logError } from '@/lib/logger';
import { PROXY_LADDER } from '@/lib/video-proxy';

/**
 * Backfill lever for cuts uploaded before proxies existed.
 *
 * New cuts queue themselves on commit; everything older has to be asked for.
 * Deliberately scoped and capped rather than "do the lot": every rung is real
 * CPU on the worker and real bytes in the bucket, so a backfill is a decision
 * someone makes per batch, not a switch that silently spends.
 *
 * POST /api/agent/transcode/enqueue
 *   { videoId }                          - every cut on one item
 *   { workspaceId?, statuses?, limit? }  - the ACTIVE cut of matching items
 *   { dryRun: true }                     - count what would be queued
 *
 * Defaults to the stages where a proxy actually earns its keep (in edit, in
 * review, approved) and to 25 items.
 */
const DEFAULT_STATUSES: VideoStatus[] = [
  VideoStatus.EDITING,
  VideoStatus.REVIEW,
  VideoStatus.APPROVED,
];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;

export async function POST(request: NextRequest) {
  try {
    if (!isTranscodeWorkerRequest(request)) {
      return apiErrors.unauthorized();
    }

    const body = await request.json().catch(() => null);
    const dryRun = body?.dryRun === true;
    const videoId = typeof body?.videoId === 'string' ? body.videoId : null;
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : null;

    const rawLimit = Number(body?.limit);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

    const rawStatuses = Array.isArray(body?.statuses) ? body.statuses : null;
    const statuses = rawStatuses
      ? rawStatuses.filter((s: unknown): s is VideoStatus =>
          (Object.values(VideoStatus) as string[]).includes(s as string)
        )
      : DEFAULT_STATUSES;
    if (statuses.length === 0) {
      return apiErrors.badRequest('statuses must name at least one valid status');
    }

    // One item: every cut on it. Otherwise: the active cut of matching items,
    // newest first — nobody is waiting on a proxy of a two-year-old draft.
    const versions = videoId
      ? await db.videoVersion.findMany({
          where: { videoParentId: videoId, providerId: 'r2' },
          select: { id: true },
        })
      : await db.videoVersion.findMany({
          where: {
            providerId: 'r2',
            isActive: true,
            video: {
              status: { in: statuses },
              ...(workspaceId ? { project: { workspaceId } } : {}),
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { id: true },
        });

    if (versions.length === 0) {
      const response = successResponse({ cuts: 0, queued: 0, alreadyQueued: 0, dryRun });
      return withCacheControl(response, 'private, no-store');
    }

    const versionIds = versions.map((version) => version.id);
    const existing = await db.videoProxy.count({ where: { versionId: { in: versionIds } } });
    const wouldQueue = versionIds.length * PROXY_LADDER.length - existing;

    if (dryRun) {
      const response = successResponse({
        cuts: versionIds.length,
        queued: 0,
        wouldQueue: Math.max(wouldQueue, 0),
        alreadyQueued: existing,
        dryRun: true,
      });
      return withCacheControl(response, 'private, no-store');
    }

    // skipDuplicates: re-running a backfill must never re-queue a rung that is
    // already done, in flight, or deliberately skipped.
    const created = await db.videoProxy.createMany({
      data: versionIds.flatMap((versionId) =>
        PROXY_LADDER.map((height) => ({ versionId, height }))
      ),
      skipDuplicates: true,
    });

    const response = successResponse({
      cuts: versionIds.length,
      queued: created.count,
      alreadyQueued: existing,
      dryRun: false,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error enqueuing transcode jobs:', error);
    return apiErrors.internalError('Failed to queue the transcodes');
  }
}
