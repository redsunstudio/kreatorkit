import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import {
  createMultipartVideoUpload,
  completeMultipartVideoUpload,
  createPresignedVideoPutUrl,
  presignVideoUploadPart,
  r2Client,
  R2_BUCKET_NAME,
} from '@/lib/r2';
import {
  buildVideoObjectKey,
  resolveVideoContentType,
  getVideoExtensionFromMime,
  videoProxyPathFromFilename,
  VIDEO_OBJECT_KEY_PREFIX,
} from '@/lib/video-upload-validation';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

const MAX_BYTES = BigInt(5 * 1024 * 1024 * 1024);
const SAFE_VIDEO_KEY =
  /^videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

// POST /api/agent/videos/[videoId]/versions — the automation cut rail.
// { init: {fileName, contentType, sizeBytes} } -> presigned PUT for the new cut
// { commit: {objectKey, label?, duration?} }   -> creates the version, makes it
//   active and flips pre-review items into REVIEW — same semantics as the UI's
//   "Upload new cut". This is how review fixes ship back onto the item.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        status: true,
        versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { versionNumber: true } },
      },
    });
    if (!video) return apiErrors.notFound('Video');

    const body = await request.json().catch(() => null);

    if (body?.init) {
      const fileName = String(body.init.fileName || 'cut.mp4');
      const contentType = resolveVideoContentType(
        fileName,
        typeof body.init.contentType === 'string' ? body.init.contentType : undefined
      );
      if (!contentType) return apiErrors.badRequest('not a supported video type');
      let sizeBytes: bigint;
      try {
        sizeBytes = BigInt(body.init.sizeBytes);
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('cuts are capped at 5GB');
      }
      const ext = getVideoExtensionFromMime(contentType) ?? 'mp4';
      const objectKey = buildVideoObjectKey(`${randomUUID()}.${ext}`);
      const presignedPutUrl = await createPresignedVideoPutUrl(objectKey, contentType, sizeBytes);
      return withCacheControl(
        successResponse({ presignedPutUrl, objectKey, contentType }),
        'private, no-store'
      );
    }

    if (body?.initMultipart) {
      const fileName = String(body.initMultipart.fileName || 'cut.mp4');
      const contentType = resolveVideoContentType(
        fileName,
        typeof body.initMultipart.contentType === 'string'
          ? body.initMultipart.contentType
          : undefined
      );
      if (!contentType) return apiErrors.badRequest('not a supported video type');
      let sizeBytes: bigint;
      try {
        sizeBytes = BigInt(body.initMultipart.sizeBytes);
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('cuts are capped at 5GB');
      }
      const partCount = Number(body.initMultipart.partCount);
      if (!Number.isInteger(partCount) || partCount < 1 || partCount > 200) {
        return apiErrors.badRequest('partCount must be 1-200');
      }
      const ext = getVideoExtensionFromMime(contentType) ?? 'mp4';
      const objectKey = buildVideoObjectKey(`${randomUUID()}.${ext}`);
      const uploadId = await createMultipartVideoUpload(objectKey, contentType);
      const partUrls = await Promise.all(
        Array.from({ length: partCount }, (_, i) =>
          presignVideoUploadPart(objectKey, uploadId, i + 1)
        )
      );
      return withCacheControl(
        successResponse({ objectKey, uploadId, contentType, partUrls }),
        'private, no-store'
      );
    }

    if (body?.completeMultipart) {
      const objectKey =
        typeof body.completeMultipart.objectKey === 'string'
          ? body.completeMultipart.objectKey
          : '';
      const uploadId =
        typeof body.completeMultipart.uploadId === 'string' ? body.completeMultipart.uploadId : '';
      const parts = Array.isArray(body.completeMultipart.parts) ? body.completeMultipart.parts : [];
      if (!SAFE_VIDEO_KEY.test(objectKey) || !uploadId || parts.length === 0) {
        return apiErrors.badRequest('objectKey, uploadId and parts are required');
      }
      const shaped = parts.map((p: { partNumber?: unknown; etag?: unknown }) => ({
        partNumber: Number(p?.partNumber),
        etag: String(p?.etag || ''),
      }));
      if (shaped.some((p: { partNumber: number; etag: string }) => !p.partNumber || !p.etag)) {
        return apiErrors.badRequest('every part needs partNumber + etag');
      }
      await completeMultipartVideoUpload(objectKey, uploadId, shaped);
      // fall through to the same commit path by reusing the commit body shape
      body.commit = {
        objectKey,
        label: body.completeMultipart.label,
        duration: body.completeMultipart.duration,
      };
    }

    if (body?.commit) {
      const objectKey = typeof body.commit.objectKey === 'string' ? body.commit.objectKey : '';
      if (!SAFE_VIDEO_KEY.test(objectKey)) {
        return apiErrors.badRequest('objectKey must reference an uploaded video');
      }
      let contentLength = BigInt(0);
      try {
        const head = await r2Client.send(
          new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey })
        );
        contentLength =
          typeof head.ContentLength === 'number' && head.ContentLength >= 0
            ? BigInt(head.ContentLength)
            : BigInt(0);
      } catch {
        return apiErrors.badRequest('Upload not found — PUT the cut first');
      }
      if (contentLength <= BigInt(0)) {
        return apiErrors.badRequest('Upload not found — PUT the cut first');
      }

      const label = typeof body.commit.label === 'string' ? body.commit.label.trim() : '';
      const duration =
        typeof body.commit.duration === 'number' && Number.isFinite(body.commit.duration)
          ? body.commit.duration
          : null;
      const nextVersionNumber = (video.versions[0]?.versionNumber || 0) + 1;
      const filename = objectKey.slice(VIDEO_OBJECT_KEY_PREFIX.length);

      // Serializable: two concurrent commits must not both leave isActive=true.
      const version = await db.$transaction(
        async (tx) => {
          await tx.videoVersion.updateMany({
            where: { videoParentId: videoId },
            data: { isActive: false },
          });
          // A fresh cut moves pre-review items (incl. sent-back EDITING) into REVIEW.
          await tx.video.updateMany({
            where: { id: videoId, status: { in: ['IDEA', 'FILMED', 'EDITING'] } },
            data: { status: 'REVIEW' },
          });
          return tx.videoVersion.create({
            data: {
              versionNumber: nextVersionNumber,
              versionLabel: label || null,
              providerId: 'r2',
              videoId: objectKey,
              originalUrl: videoProxyPathFromFilename(filename),
              title: label || `Version ${nextVersionNumber}`,
              thumbnailUrl: '/placeholder-video-thumbnail.png',
              duration,
              sizeBytes: contentLength,
              isActive: true,
              videoParentId: videoId,
            },
          });
        },
        { isolationLevel: 'Serializable' }
      );

      const updated = await db.video.findUnique({
        where: { id: videoId },
        select: { status: true },
      });
      return withCacheControl(
        successResponse(
          {
            versionId: version.id,
            versionNumber: version.versionNumber,
            isActive: version.isActive,
            sizeBytes: contentLength.toString(),
            status: updated?.status ?? video.status,
          },
          201
        ),
        'private, no-store'
      );
    }

    return apiErrors.badRequest('send { init } or { commit }');
  } catch (error) {
    logError('agent version upload failed:', error);
    return apiErrors.internalError('Failed to create the version');
  }
}
