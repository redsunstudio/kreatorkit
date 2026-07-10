import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { auth, checkProjectAccess } from '@/lib/auth';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import {
  createR2UploadToken,
  parseR2UploadToken,
  verifyR2UploadToken,
} from '@/lib/r2-upload-token';
import {
  abortMultipartVideoUpload,
  completeMultipartVideoUpload,
  createMultipartVideoUpload,
  createPresignedImagePutUrl,
  createPresignedVideoPutUrl,
  deleteR2Object,
  deleteVideoObject,
  presignVideoUploadPart,
} from '@/lib/r2';
import { getMaxVideoUploadBytes, isS3VideoUploadsEnabled } from '@/lib/feature-flags';
import {
  buildVideoObjectKey,
  getVideoExtensionFromMime,
  resolveVideoContentType,
  videoProxyPathFromFilename,
} from '@/lib/video-upload-validation';
import { logError } from '@/lib/logger';
import {
  enforceStorageQuota,
  releaseStorageReservation,
  reserveStorageQuota,
} from '@/lib/storage-quota';
import { createR2UploadSession } from '@/lib/r2-upload-session';

type RouteParams = { params: Promise<{ projectId: string }> };

const VIDEO_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
const THUMBNAIL_RESERVE_BYTES = BigInt(512 * 1024);

async function getProjectWithEditAccess(projectId: string, userId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      workspaceId: true,
      visibility: true,
      workspace: { select: { ownerId: true } },
    },
  });

  if (!project) return null;

  const access = await checkProjectAccess(project, userId, { intent: 'manage' });
  if (!access.canEdit) return null;

  return project;
}

// POST /api/projects/[projectId]/videos/r2-init
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { projectId } = await params;

    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }

    if (!isS3VideoUploadsEnabled()) {
      return apiErrors.badRequest('S3 video uploads are disabled by this host');
    }

    const project = await getProjectWithEditAccess(projectId, session.user.id);
    if (!project) {
      return apiErrors.forbidden('Access denied');
    }

    const body = await request.json().catch(() => null);
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
    const contentTypeInput = typeof body?.contentType === 'string' ? body.contentType.trim() : '';
    const sizeBytesRaw = body?.sizeBytes;

    if (!fileName) {
      return apiErrors.badRequest('fileName is required');
    }

    let sizeBytes: bigint;
    try {
      sizeBytes = BigInt(sizeBytesRaw);
      if (sizeBytes <= BigInt(0)) {
        return apiErrors.badRequest('sizeBytes must be a positive integer');
      }
    } catch {
      return apiErrors.badRequest('sizeBytes must be a positive integer');
    }

    const maxBytes = getMaxVideoUploadBytes();
    if (sizeBytes > maxBytes) {
      return apiErrors.badRequest('Video file exceeds the maximum allowed upload size');
    }

    const contentType = resolveVideoContentType(fileName, contentTypeInput);
    if (!contentType) {
      return apiErrors.badRequest('Unsupported video format');
    }

    const ext = getVideoExtensionFromMime(contentType);
    if (!ext) {
      return apiErrors.badRequest('Unsupported video format');
    }

    const quotaError = await enforceStorageQuota(
      project.workspace.ownerId,
      sizeBytes + THUMBNAIL_RESERVE_BYTES
    );
    if (quotaError) return quotaError;

    const reserveResult = await reserveStorageQuota(
      project.workspace.ownerId,
      sizeBytes + THUMBNAIL_RESERVE_BYTES,
      VIDEO_RESERVATION_TTL_MS
    );
    if ('error' in reserveResult) return reserveResult.error;

    const partCountRaw = body?.partCount;
    let partCount = 0;
    if (partCountRaw !== undefined && partCountRaw !== null) {
      partCount = Number(partCountRaw);
      if (!Number.isInteger(partCount) || partCount < 2 || partCount > 200) {
        return apiErrors.badRequest('partCount must be an integer between 2 and 200');
      }
    }

    const fileId = randomUUID();
    const filename = `${fileId}.${ext}`;
    const objectKey = buildVideoObjectKey(filename);
    const proxyUrl = videoProxyPathFromFilename(filename);
    const thumbnailFilename = `${fileId}.jpg`;
    const thumbnailObjectKey = `images/${thumbnailFilename}`;
    const thumbnailProxyUrl = `/api/upload/image/${thumbnailFilename}`;

    let presignedPutUrl: string | null = null;
    let uploadId: string | null = null;
    let partUrls: string[] | null = null;
    let thumbnailPresignedPutUrl: string;
    try {
      if (partCount > 0) {
        // Multipart: parallel part PUTs beat a single stream on high-RTT paths.
        [uploadId, thumbnailPresignedPutUrl] = await Promise.all([
          createMultipartVideoUpload(objectKey, contentType),
          createPresignedImagePutUrl(thumbnailObjectKey, 'image/jpeg'),
        ]);
        const confirmedUploadId = uploadId;
        partUrls = await Promise.all(
          Array.from({ length: partCount }, (_, i) =>
            presignVideoUploadPart(objectKey, confirmedUploadId, i + 1)
          )
        );
      } else {
        [presignedPutUrl, thumbnailPresignedPutUrl] = await Promise.all([
          createPresignedVideoPutUrl(objectKey, contentType, sizeBytes),
          createPresignedImagePutUrl(thumbnailObjectKey, 'image/jpeg'),
        ]);
      }
    } catch (error) {
      await releaseStorageReservation(reserveResult.reservationId, project.workspace.ownerId);
      logError('Failed to create presigned video upload URL:', error);
      return apiErrors.internalError('Failed to initialize video upload');
    }

    const uploadJti = randomUUID();
    const expiresAt = new Date(Date.now() + VIDEO_RESERVATION_TTL_MS);
    const uploadSession = await createR2UploadSession({
      userId: session.user.id,
      projectId,
      billedUserId: project.workspace.ownerId,
      objectKey,
      thumbnailObjectKey,
      declaredSizeBytes: sizeBytes,
      contentType,
      reservationId: reserveResult.reservationId,
      uploadJti,
      expiresAt,
    });

    const uploadToken = createR2UploadToken({
      userId: session.user.id,
      projectId,
      objectKey,
      sessionId: uploadSession.id,
      tokenId: uploadJti,
      thumbnailObjectKey,
    });

    const response = successResponse({
      presignedPutUrl,
      uploadId,
      partUrls,
      objectKey,
      proxyUrl,
      uploadToken,
      reservationId: reserveResult.reservationId,
      contentType,
      thumbnailPresignedPutUrl,
      thumbnailObjectKey,
      thumbnailProxyUrl,
    });

    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error initializing R2 video upload:', error);
    return apiErrors.internalError('Failed to initialize upload');
  }
}

// PATCH /api/projects/[projectId]/videos/r2-init — complete a multipart upload.
// { objectKey, uploadId, uploadToken } — the server lists the uploaded parts
// itself (browsers can't read part ETags without exposeHeaders CORS) and
// assembles the object so the normal versions-POST finalize path can consume it.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { projectId } = await params;
    if (!session?.user?.id) return apiErrors.unauthorized();
    if (!isS3VideoUploadsEnabled()) {
      return apiErrors.badRequest('S3 video uploads are disabled by this host');
    }
    const project = await getProjectWithEditAccess(projectId, session.user.id);
    if (!project) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);
    const objectKey = typeof body?.objectKey === 'string' ? body.objectKey.trim() : '';
    const uploadId = typeof body?.uploadId === 'string' ? body.uploadId.trim() : '';
    const uploadToken = typeof body?.uploadToken === 'string' ? body.uploadToken.trim() : '';
    if (!objectKey || !uploadId || !uploadToken) {
      return apiErrors.badRequest('objectKey, uploadId and uploadToken are required');
    }

    const tokenPayload = parseR2UploadToken(uploadToken);
    if (!tokenPayload) return apiErrors.forbidden('Invalid upload token');
    const isValidUploadToken = verifyR2UploadToken(uploadToken, {
      userId: session.user.id,
      projectId,
      objectKey,
      sessionId: tokenPayload.sid,
      tokenId: tokenPayload.jti,
    });
    if (!isValidUploadToken) return apiErrors.forbidden('Invalid upload token');

    const uploadSession = await db.videoUploadSession.findFirst({
      where: {
        id: tokenPayload.sid,
        status: 'INITIATED',
        userId: session.user.id,
        projectId,
        objectKey,
        uploadJti: tokenPayload.jti,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!uploadSession) return apiErrors.forbidden('Invalid upload token');

    try {
      await completeMultipartVideoUpload(objectKey, uploadId);
    } catch (error) {
      logError('Multipart completion failed:', error);
      await abortMultipartVideoUpload(objectKey, uploadId).catch(() => {});
      return apiErrors.internalError('Failed to assemble the uploaded parts');
    }

    return withCacheControl(successResponse({ ok: true, objectKey }), 'private, no-store');
  } catch (error) {
    logError('Error completing multipart upload:', error);
    return apiErrors.internalError('Failed to complete upload');
  }
}

// DELETE /api/projects/[projectId]/videos/r2-init
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { projectId } = await params;

    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }

    if (!isS3VideoUploadsEnabled()) {
      return apiErrors.badRequest('S3 video uploads are disabled by this host');
    }

    const project = await getProjectWithEditAccess(projectId, session.user.id);
    if (!project) {
      return apiErrors.forbidden('Access denied');
    }

    const body = await request.json().catch(() => null);
    const objectKey = typeof body?.objectKey === 'string' ? body.objectKey.trim() : '';
    const uploadToken = typeof body?.uploadToken === 'string' ? body.uploadToken.trim() : '';
    const thumbnailObjectKey =
      typeof body?.thumbnailObjectKey === 'string' ? body.thumbnailObjectKey.trim() : '';

    if (!objectKey || !uploadToken) {
      return apiErrors.badRequest('objectKey and uploadToken are required');
    }

    const tokenPayload = parseR2UploadToken(uploadToken);
    if (!tokenPayload) {
      return apiErrors.forbidden('Invalid upload token');
    }

    const isValidUploadToken = verifyR2UploadToken(uploadToken, {
      userId: session.user.id,
      projectId,
      objectKey,
      sessionId: tokenPayload.sid,
      tokenId: tokenPayload.jti,
    });
    if (!isValidUploadToken) {
      return apiErrors.forbidden('Invalid upload token');
    }

    const uploadSession = await db.videoUploadSession.findFirst({
      where: {
        id: tokenPayload.sid,
        status: 'INITIATED',
        userId: session.user.id,
        projectId,
        objectKey,
        uploadJti: tokenPayload.jti,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        reservationId: true,
        billedUserId: true,
        thumbnailObjectKey: true,
      },
    });
    if (!uploadSession) {
      return apiErrors.forbidden('Invalid upload token');
    }

    if (thumbnailObjectKey && thumbnailObjectKey !== uploadSession.thumbnailObjectKey) {
      return apiErrors.badRequest('Invalid thumbnail object key');
    }

    const cancelled = await db.videoUploadSession.updateMany({
      where: {
        id: uploadSession.id,
        status: 'INITIATED',
      },
      data: {
        status: 'CANCELLED',
        consumedAt: new Date(),
      },
    });
    if (cancelled.count !== 1) {
      return apiErrors.forbidden('Invalid upload token');
    }

    try {
      await Promise.all([
        deleteVideoObject(objectKey),
        uploadSession.thumbnailObjectKey.startsWith('images/')
          ? deleteR2Object(uploadSession.thumbnailObjectKey)
          : Promise.resolve(),
      ]);
    } catch (error) {
      logError('Failed to delete pending R2 video object:', error);
    }

    await releaseStorageReservation(uploadSession.reservationId, uploadSession.billedUserId);

    const response = successResponse({ message: 'Pending upload cleaned up' });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error cleaning up pending R2 video upload:', error);
    return apiErrors.internalError('Failed to cleanup pending upload');
  }
}
