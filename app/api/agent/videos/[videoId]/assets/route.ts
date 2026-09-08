import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartFileUpload,
  createPresignedFilePutUrl,
  getR2FileObjectMetadata,
  presignUploadPart,
  safeUploadContentType,
} from '@/lib/r2';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// 5 GiB is S3's SINGLE-PUT ceiling, not a storage limit — `init` still honours it because
// it hands back one presigned PUT. Anything larger must come through `initMultipart`.
const MAX_SINGLE_PUT_BYTES = BigInt(5 * 1024 * 1024 * 1024);
// Sanity guard for multipart, not a product limit: raw camera ISOs run 8-24 GB each.
const MAX_BYTES = BigInt(200) * BigInt(1024 * 1024 * 1024);
// S3 allows 10,000 parts. A bigger ceiling means SMALLER parts, so a dropped part on a
// flaky line costs 32 MB of re-upload instead of 120 MB.
const MAX_PARTS = 10000;
const SAFE_FILE_KEY = /^files\/[A-Za-z0-9-]{36}-[A-Za-z0-9._ ()-]{1,160}$/;

function sanitizeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.\.+/g, '.');
  return base.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 160) || 'file';
}

function kindFor(
  contentType: string | undefined,
  name: string
): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' {
  const ct = contentType ?? '';
  if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name)) return 'IMAGE';
  if (ct.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(name)) return 'VIDEO';
  if (ct.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac)$/i.test(name)) return 'AUDIO';
  return 'FILE';
}

// POST /api/agent/videos/[videoId]/assets — the automation media rail.
// { init: {fileName, contentType, sizeBytes} } -> presigned PUT
// { commit: {objectKey, displayName} } -> creates the asset on the item
// This is how agent-drafted posts get their images/PDFs attached.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        project: { select: { workspace: { select: { ownerId: true } } } },
      },
    });
    if (!video) return apiErrors.notFound('Video');

    const body = await request.json().catch(() => null);

    if (body?.init) {
      const fileName = sanitizeName(String(body.init.fileName || ''));
      const contentType = safeUploadContentType(
        typeof body.init.contentType === 'string' && body.init.contentType.trim()
          ? body.init.contentType.trim()
          : 'application/octet-stream'
      );
      let sizeBytes: bigint;
      try {
        sizeBytes = BigInt(body.init.sizeBytes);
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_SINGLE_PUT_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('single-PUT files are capped at 5GB — use initMultipart');
      }
      const objectKey = `files/${randomUUID()}-${fileName}`;
      const presignedPutUrl = await createPresignedFilePutUrl(objectKey, contentType, sizeBytes);
      return withCacheControl(
        successResponse({ presignedPutUrl, objectKey, contentType, displayName: fileName }),
        'private, no-store'
      );
    }

    // Multipart: the only route for raw footage. Mirrors the cuts rail so the agent
    // client can use one upload strategy for both.
    if (body?.initMultipart) {
      const fileName = sanitizeName(String(body.initMultipart.fileName || ''));
      const contentType = safeUploadContentType(
        typeof body.initMultipart.contentType === 'string' && body.initMultipart.contentType.trim()
          ? body.initMultipart.contentType.trim()
          : 'application/octet-stream'
      );
      let sizeBytes: bigint;
      try {
        sizeBytes = BigInt(body.initMultipart.sizeBytes);
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('files are capped at 200GB');
      }
      const partCount = Number(body.initMultipart.partCount);
      if (!Number.isInteger(partCount) || partCount < 1 || partCount > MAX_PARTS) {
        return apiErrors.badRequest(`partCount must be 1-${MAX_PARTS}`);
      }
      const objectKey = `files/${randomUUID()}-${fileName}`;
      const uploadId = await createMultipartFileUpload(objectKey, contentType);
      const partUrls = await Promise.all(
        Array.from({ length: partCount }, (_, i) => presignUploadPart(objectKey, uploadId, i + 1))
      );
      return withCacheControl(
        successResponse({ objectKey, uploadId, contentType, partUrls, displayName: fileName }),
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
      if (!SAFE_FILE_KEY.test(objectKey) || !uploadId) {
        return apiErrors.badRequest('objectKey and uploadId are required');
      }
      const parts = Array.isArray(body.completeMultipart.parts)
        ? body.completeMultipart.parts.map((p: { partNumber?: unknown; etag?: unknown }) => ({
            partNumber: Number(p?.partNumber),
            etag: String(p?.etag || ''),
          }))
        : [];
      if (parts.some((p: { partNumber: number; etag: string }) => !p.partNumber || !p.etag)) {
        return apiErrors.badRequest('every part needs partNumber + etag');
      }
      // parts omitted => the helper lists them off the bucket (browsers cannot read ETags).
      await completeMultipartUpload(objectKey, uploadId, parts.length ? parts : undefined);
      body.commit = { objectKey, displayName: body.completeMultipart.displayName };
    }

    // Orphaned multipart uploads are BILLED by B2 until aborted — always give the client
    // a way to clean up after a failed run.
    if (body?.abortMultipart) {
      const objectKey =
        typeof body.abortMultipart.objectKey === 'string' ? body.abortMultipart.objectKey : '';
      const uploadId =
        typeof body.abortMultipart.uploadId === 'string' ? body.abortMultipart.uploadId : '';
      if (!SAFE_FILE_KEY.test(objectKey) || !uploadId) {
        return apiErrors.badRequest('objectKey and uploadId are required');
      }
      await abortMultipartUpload(objectKey, uploadId);
      return withCacheControl(successResponse({ aborted: true }), 'private, no-store');
    }

    if (body?.commit) {
      const objectKey = typeof body.commit.objectKey === 'string' ? body.commit.objectKey : '';
      if (!/^files\/[A-Za-z0-9-]{36}-[A-Za-z0-9._ ()-]{1,160}$/.test(objectKey)) {
        return apiErrors.badRequest('objectKey must reference an uploaded file');
      }
      const head = await getR2FileObjectMetadata(objectKey);
      if (!head || head.contentLength <= BigInt(0)) {
        return apiErrors.badRequest('Upload not found — PUT the file first');
      }
      const displayName = sanitizeName(
        String(body.commit.displayName || objectKey.slice(objectKey.indexOf('-') + 1) || 'file')
      );
      const asset = await db.videoAsset.create({
        data: {
          videoId: video.id,
          kind: kindFor(head.contentType, displayName),
          provider: 'R2_FILE',
          displayName,
          sourceUrl: objectKey,
          sizeBytes: head.contentLength,
          billedUserId: video.project.workspace.ownerId,
          uploadedByGuestName: 'Agency OS',
        },
      });
      return withCacheControl(
        successResponse({ id: asset.id, kind: asset.kind, displayName: asset.displayName }, 201),
        'private, no-store'
      );
    }

    return apiErrors.badRequest(
      'Provide init, initMultipart, completeMultipart, abortMultipart or commit'
    );
  } catch (error) {
    logError('agent asset upload failed:', error);
    return apiErrors.internalError('Failed to attach the file');
  }
}
