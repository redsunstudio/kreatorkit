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

// POST /api/agent/transcode/claim  { batch?: boolean }
//
// The transcode worker's only entry point into the queue. Hands back the work
// with everything needed to do it without any further calls: a presigned read of
// the master and a presigned write for each proxy. Bytes never pass through this
// app (see the 2026-07-13 OOM incident).
//
// batch:true hands back EVERY claimable rung of one cut instead of a single one.
// Each rung used to be an independent job that ffmpeg'd straight from the
// presigned URL, so a three-rung ladder pulled the same master out of storage
// three times. The 2026-08-06 backfill moved ~130GB to do ~45GB of work. A
// batching worker downloads once and encodes the ladder off that copy.
//
// The flag is the worker's, not ours: an older worker that cannot handle a
// ladder simply does not ask, and still gets exactly one job. That keeps the two
// services independently deployable in either order.
export async function POST(request: NextRequest) {
  try {
    if (!isTranscodeWorkerRequest(request)) {
      return apiErrors.unauthorized();
    }

    const body = await request.json().catch(() => null);
    const batch = body?.batch === true;
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const claimable = [
      { status: VideoProxyStatus.PENDING },
      { status: VideoProxyStatus.PROCESSING, claimedAt: { lt: staleBefore } },
      { status: VideoProxyStatus.FAILED },
    ];

    // Claim atomically: updateMany gated on the row still being claimable means
    // two workers polling at the same moment can never take the same rung.
    // A reported failure is retryable until it has used its attempts. Without
    // that, MAX_ATTEMPTS only ever governed stale-claim reclaims and one
    // transient blip (a 500 on the upload leg, a storage hiccup) cost that rung
    // permanently — nothing would ever pick it up again. Genuinely broken
    // sources still stop after MAX_ATTEMPTS.
    const candidate = await db.videoProxy.findFirst({
      where: { attempts: { lt: MAX_ATTEMPTS }, OR: claimable },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, height: true, versionId: true },
    });

    if (!candidate) {
      const response = successResponse({ job: null, jobs: [] });
      return withCacheControl(response, 'private, no-store');
    }

    // Claim atomically: updateMany gated on the rows still being claimable means
    // two workers polling at the same moment can never take the same rung. The
    // exact claimedAt is what identifies OUR batch on the read-back — a rung a
    // rival worker already took is PROCESSING with a different, fresh timestamp,
    // so it matches none of the claimable conditions and stays theirs.
    const claimedAt = new Date();
    const claimed = await db.videoProxy.updateMany({
      where: batch
        ? { versionId: candidate.versionId, attempts: { lt: MAX_ATTEMPTS }, OR: claimable }
        : {
            id: candidate.id,
            status: candidate.status,
            ...(candidate.status === VideoProxyStatus.PROCESSING
              ? { claimedAt: { lt: staleBefore } }
              : {}),
          },
      data: {
        status: VideoProxyStatus.PROCESSING,
        claimedAt,
        attempts: { increment: 1 },
        error: null,
      },
    });
    if (claimed.count < 1) {
      // Another worker got there first — it will be picked up on the next poll.
      const response = successResponse({ job: null, jobs: [] });
      return withCacheControl(response, 'private, no-store');
    }

    const rungs = batch
      ? await db.videoProxy.findMany({
          where: { versionId: candidate.versionId, status: VideoProxyStatus.PROCESSING, claimedAt },
          orderBy: { height: 'desc' },
          select: { id: true, height: true },
        })
      : [{ id: candidate.id, height: candidate.height }];

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

    const head = version && sourceKey ? await headVideoObject(sourceKey) : null;
    if (!version || !sourceKey || !head) {
      // Fail the whole claimed batch, not just the rung that led us here — they
      // all share the one missing master.
      await db.videoProxy.updateMany({
        where: { id: { in: rungs.map((r) => r.id) } },
        data: {
          status: VideoProxyStatus.FAILED,
          error: 'Source cut is missing or is not stored in our bucket',
        },
      });
      const response = successResponse({ job: null, jobs: [] });
      return withCacheControl(response, 'private, no-store');
    }

    // One presigned read for the whole ladder — the worker fetches the master
    // once and encodes every rung from that copy.
    const sourceUrl = await createPresignedInlineGetUrl(sourceKey, 'video/mp4');
    const jobs = await Promise.all(
      rungs.map(async (rung) => {
        const objectKey = proxyObjectKey(version.id, rung.height);
        return {
          proxyId: rung.id,
          versionId: version.id,
          videoId: version.video.id,
          videoTitle: version.video.title,
          height: rung.height,
          knownSourceHeight: version.sourceHeight,
          sourceBytes: head.contentLength ? head.contentLength.toString() : null,
          objectKey,
          sourceUrl,
          uploadUrl: await createPresignedProxyPutUrl(objectKey),
        };
      })
    );

    // `job` stays for a worker that did not ask for a batch.
    const response = successResponse({ job: jobs[0] ?? null, jobs });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error claiming a transcode job:', error);
    return apiErrors.internalError('Failed to claim a transcode job');
  }
}
