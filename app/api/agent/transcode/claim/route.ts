import { NextRequest } from 'next/server';
import { VideoProxyStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isTranscodeWorkerRequest } from '@/lib/transcode-auth';
import { logError } from '@/lib/logger';
import { createPresignedInlineGetUrl, createPresignedProxyPutUrl, headVideoObject } from '@/lib/r2';
import { proxyObjectKey } from '@/lib/video-proxy';
import { videoProxyPathToObjectKey } from '@/lib/video-upload-validation';

/** A claim this old is assumed dead (worker crashed / redeployed) and is retried. */
const STALE_CLAIM_MS = 6 * 60 * 60 * 1000;
/** After this many goes at the same rung we stop burning CPU on it. */
const MAX_ATTEMPTS = 3;

// POST /api/agent/transcode/claim
//
// The transcode worker's only entry point into the queue. Hands back one job
// with everything needed to do the work without any further calls: a presigned
// read of the master and a presigned write for the proxy. Bytes never pass
// through this app (see the 2026-07-13 OOM incident).
export async function POST(request: NextRequest) {
  try {
    if (!isTranscodeWorkerRequest(request)) {
      return apiErrors.unauthorized();
    }

    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

    // Claim atomically: updateMany gated on the row still being claimable means
    // two workers polling at the same moment can never take the same rung.
    const candidate = await db.videoProxy.findFirst({
      where: {
        attempts: { lt: MAX_ATTEMPTS },
        OR: [
          { status: VideoProxyStatus.PENDING },
          { status: VideoProxyStatus.PROCESSING, claimedAt: { lt: staleBefore } },
          // A reported failure is retryable until it has used its attempts.
          // Without this, MAX_ATTEMPTS only ever governed stale-claim reclaims
          // and one transient blip (a 500 on the upload leg, a B2 hiccup) cost
          // that rung permanently — nothing in the system would ever pick it up
          // again. Genuinely broken sources still stop after MAX_ATTEMPTS.
          { status: VideoProxyStatus.FAILED },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, height: true, versionId: true },
    });

    if (!candidate) {
      const response = successResponse({ job: null });
      return withCacheControl(response, 'private, no-store');
    }

    const claimed = await db.videoProxy.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.status === VideoProxyStatus.PROCESSING
          ? { claimedAt: { lt: staleBefore } }
          : {}),
      },
      data: {
        status: VideoProxyStatus.PROCESSING,
        claimedAt: new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    });
    if (claimed.count !== 1) {
      // Another worker got there first — it will be picked up on the next poll.
      const response = successResponse({ job: null });
      return withCacheControl(response, 'private, no-store');
    }

    const version = await db.videoVersion.findUnique({
      where: { id: candidate.versionId },
      select: {
        id: true,
        providerId: true,
        originalUrl: true,
        sourceHeight: true,
        video: { select: { id: true, title: true } },
      },
    });

    const sourceKey =
      version && version.providerId === 'r2'
        ? videoProxyPathToObjectKey(version.originalUrl)
        : null;

    if (!version || !sourceKey || !(await headVideoObject(sourceKey))) {
      await db.videoProxy.update({
        where: { id: candidate.id },
        data: {
          status: VideoProxyStatus.FAILED,
          error: 'Source cut is missing or is not stored in our bucket',
        },
      });
      const response = successResponse({ job: null });
      return withCacheControl(response, 'private, no-store');
    }

    const objectKey = proxyObjectKey(version.id, candidate.height);
    const [sourceUrl, uploadUrl] = await Promise.all([
      createPresignedInlineGetUrl(sourceKey, 'video/mp4'),
      createPresignedProxyPutUrl(objectKey),
    ]);

    const response = successResponse({
      job: {
        proxyId: candidate.id,
        versionId: version.id,
        videoId: version.video.id,
        videoTitle: version.video.title,
        height: candidate.height,
        knownSourceHeight: version.sourceHeight,
        objectKey,
        sourceUrl,
        uploadUrl,
      },
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error claiming a transcode job:', error);
    return apiErrors.internalError('Failed to claim a transcode job');
  }
}
