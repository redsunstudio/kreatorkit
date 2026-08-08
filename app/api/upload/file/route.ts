import { NextRequest } from 'next/server';
import { auth, checkProjectAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { r2Client, R2_BUCKET_NAME, safeUploadContentType } from '@/lib/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { rateLimit } from '@/lib/rate-limit';
import { validateShareLinkAccess } from '@/lib/share-links';
import { getShareSessionFromRequest } from '@/lib/share-session';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import {
  deriveGuestUploadContext,
  enforceGuestUploadQuota,
  verifyGuestUploadToken,
} from '@/lib/guest-upload-token';
import { logError } from '@/lib/logger';
import { reserveStorageQuota, releaseStorageReservation } from '@/lib/storage-quota';

// Generic comment file attachments (PDFs, docs, subtitle files, ...).
// Bounded buffer like the image route - 25MB is plenty for review paperwork
// and small enough that piping it through the app is safe.
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_MULTIPART_BODY_SIZE = MAX_FILE_SIZE + 512 * 1024;

// Lowercased alphanumeric extension from the original name; anything odd
// becomes .bin. The stored key is always {uuid}.{ext} - the original name
// only travels as Comment.fileName display text.
function safeExtension(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,10}$/.test(ext) && ext !== originalName.toLowerCase() ? ext : 'bin';
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = request.headers.get('content-length');
    if (!contentLength) {
      return apiErrors.badRequest('Missing Content-Length header');
    }
    const bodySize = parseInt(contentLength, 10);
    if (isNaN(bodySize) || bodySize <= 0) {
      return apiErrors.badRequest('Invalid Content-Length header');
    }
    if (bodySize > MAX_MULTIPART_BODY_SIZE) {
      return apiErrors.badRequest('File too large. Maximum size is 25MB.');
    }

    const limited = await rateLimit(request, 'image-upload');
    if (limited) return limited;

    const session = await auth();

    const formData = await request.formData();
    const files = formData.getAll('file');
    if (files.length !== 1) {
      return apiErrors.badRequest('No file provided');
    }
    const file = files[0];
    const videoId = formData.get('videoId');
    const uploadToken = formData.get('uploadToken');

    if (!(file instanceof File)) {
      return apiErrors.badRequest('No file provided');
    }
    if (typeof videoId !== 'string' || !videoId.trim()) {
      return apiErrors.badRequest('videoId is required');
    }

    const safeVideoId = videoId.trim();
    const video = await db.video.findUnique({
      where: { id: safeVideoId },
      include: {
        project: {
          include: { workspace: { select: { ownerId: true } } },
        },
      },
    });
    if (!video) {
      return apiErrors.notFound('Video');
    }

    const access = await checkProjectAccess(video.project, session?.user?.id);
    const shareSession = getShareSessionFromRequest(request, safeVideoId);
    const shareAccess = shareSession
      ? await validateShareLinkAccess({
          token: shareSession.token,
          projectId: video.projectId,
          videoId: safeVideoId,
          requiredPermission: 'COMMENT',
          passwordVerified: shareSession.passwordVerified,
        })
      : {
          hasAccess: false,
          canComment: false,
          canDownload: false,
          allowGuests: false,
          requiresPassword: false,
        };
    const canCommentWithMembership = !!session?.user?.id && access.hasAccess;
    const canCommentWithShareLink =
      shareAccess.canComment && (session?.user?.id ? true : shareAccess.allowGuests);
    if (!canCommentWithMembership && !canCommentWithShareLink) {
      return apiErrors.forbidden('Access denied');
    }

    if (!session?.user?.id) {
      if (typeof uploadToken !== 'string' || !uploadToken.trim()) {
        return apiErrors.badRequest('uploadToken is required for guest uploads');
      }

      const expectedContext = deriveGuestUploadContext(request, shareSession?.token ?? null);
      if (!expectedContext) {
        return apiErrors.forbidden('Missing trusted client IP header');
      }

      const isValidUploadToken = verifyGuestUploadToken(uploadToken.trim(), {
        projectId: video.projectId,
        videoId: safeVideoId,
        intent: 'file',
        context: expectedContext,
      });
      if (!isValidUploadToken) {
        return apiErrors.forbidden('Invalid upload token');
      }

      const quotaError = await enforceGuestUploadQuota(
        request,
        safeVideoId,
        'file',
        shareSession?.token ?? null
      );
      if (quotaError) return quotaError;
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiErrors.badRequest('File too large. Maximum size is 25MB.');
    }

    const workspaceOwnerId = video.project.workspace.ownerId;
    const reserveResult = await reserveStorageQuota(workspaceOwnerId, BigInt(file.size));
    if ('error' in reserveResult) return reserveResult.error;
    const reservationId = reserveResult.reservationId;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filename = `${randomUUID()}.${safeExtension(file.name || '')}`;
    const key = `comment-files/${filename}`;

    try {
      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          // Scriptable types are stored as octet-stream, and the serving route
          // only ever hands out attachment-disposition presigns - the file can
          // never execute in the app's origin.
          ContentType: safeUploadContentType(file.type || 'application/octet-stream'),
        })
      );
    } catch (uploadError) {
      await releaseStorageReservation(reservationId);
      throw uploadError;
    }

    const fileUrl = `/api/upload/file/${filename}`;

    const response = successResponse({ url: fileUrl, reservationId }, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error uploading file:', error);
    return apiErrors.internalError('Failed to upload file');
  }
}
