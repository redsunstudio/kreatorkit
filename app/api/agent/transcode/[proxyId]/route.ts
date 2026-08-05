import { NextRequest } from 'next/server';
import { VideoProxyStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isTranscodeWorkerRequest } from '@/lib/transcode-auth';
import { logError } from '@/lib/logger';
import { headProxyObject } from '@/lib/r2';
import { proxyObjectKey } from '@/lib/video-proxy';

type RouteParams = { params: Promise<{ proxyId: string }> };

function clampInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded < 100000 ? rounded : null;
}

// POST /api/agent/transcode/[proxyId]
//
// The worker reports back here. Three outcomes:
//   { result: 'ready' }    - encode uploaded; we verify the object really landed
//   { result: 'skipped' }  - this rung is taller than the source, nothing to do
//   { result: 'failed' }   - with an error string, for the next claim to retry
// Source geometry rides along so later rungs can be skipped without re-probing.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isTranscodeWorkerRequest(request)) {
      return apiErrors.unauthorized();
    }

    const { proxyId } = await params;
    const body = await request.json().catch(() => null);
    const result = body?.result;

    const proxy = await db.videoProxy.findUnique({
      where: { id: proxyId },
      select: { id: true, versionId: true, height: true, attempts: true },
    });
    if (!proxy) return apiErrors.notFound('Transcode job');

    const sourceWidth = clampInt(body?.sourceWidth);
    const sourceHeight = clampInt(body?.sourceHeight);
    if (sourceWidth && sourceHeight) {
      await db.videoVersion.update({
        where: { id: proxy.versionId },
        data: { sourceWidth, sourceHeight },
      });
    }

    if (result === 'skipped') {
      await db.videoProxy.update({
        where: { id: proxy.id },
        data: {
          status: VideoProxyStatus.SKIPPED,
          error: null,
          objectKey: null,
        },
      });
      return withCacheControl(successResponse({ status: 'SKIPPED' }), 'private, no-store');
    }

    if (result === 'failed') {
      const message =
        typeof body?.error === 'string' && body.error.trim()
          ? body.error.trim().slice(0, 500)
          : 'Transcode failed';
      await db.videoProxy.update({
        where: { id: proxy.id },
        data: { status: VideoProxyStatus.FAILED, error: message },
      });
      return withCacheControl(successResponse({ status: 'FAILED' }), 'private, no-store');
    }

    if (result !== 'ready') {
      return apiErrors.badRequest("result must be one of 'ready', 'skipped', 'failed'");
    }

    // Trust nothing: a worker can claim success without the bytes having landed.
    const objectKey = proxyObjectKey(proxy.versionId, proxy.height);
    const head = await headProxyObject(objectKey);
    if (!head || head.contentLength <= BigInt(0)) {
      await db.videoProxy.update({
        where: { id: proxy.id },
        data: {
          status: VideoProxyStatus.FAILED,
          error: 'Worker reported ready but no proxy object was found in storage',
        },
      });
      return apiErrors.badRequest('No uploaded proxy object found for this job');
    }

    await db.videoProxy.update({
      where: { id: proxy.id },
      data: {
        status: VideoProxyStatus.READY,
        objectKey,
        sizeBytes: head.contentLength,
        width: clampInt(body?.width),
        error: null,
      },
    });

    return withCacheControl(
      successResponse({ status: 'READY', sizeBytes: head.contentLength.toString() }),
      'private, no-store'
    );
  } catch (error) {
    logError('Error completing a transcode job:', error);
    return apiErrors.internalError('Failed to update the transcode job');
  }
}
