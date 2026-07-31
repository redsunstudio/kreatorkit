import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import {
  createMultipartFileUpload,
  createPresignedFilePutUrl,
  presignVideoUploadPart,
  safeUploadContentType,
} from '@/lib/r2';
import { isS3VideoUploadsEnabled } from '@/lib/feature-flags';
import { enforceStorageQuota } from '@/lib/storage-quota';
import {
  DRIVE_FILE_MAX_BYTES,
  DRIVE_MAX_PARTS,
  driveObjectKey,
  sanitizeDriveFileName,
} from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// POST /api/workspaces/[id]/drive/upload/init  { fileName, contentType, sizeBytes, partCount? }
// Team-initiated Drive upload — same presign shape as the public grab link
// (app/api/u/[token]/init) but gated by session membership instead of a
// no-login token.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'drive-upload-init');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    if (!isS3VideoUploadsEnabled()) {
      return apiErrors.badRequest('Direct uploads are disabled by this host');
    }

    const body = await request.json().catch(() => null);
    const fileName =
      typeof body?.fileName === 'string' ? sanitizeDriveFileName(body.fileName.trim()) : '';
    if (!fileName) return apiErrors.badRequest('fileName is required');

    const contentType = safeUploadContentType(
      typeof body?.contentType === 'string' && body.contentType.trim()
        ? body.contentType.trim()
        : 'application/octet-stream'
    );

    let sizeBytes: bigint;
    try {
      sizeBytes = BigInt(body?.sizeBytes);
      if (sizeBytes <= BigInt(0)) throw new Error('non-positive');
    } catch {
      return apiErrors.badRequest('sizeBytes must be a positive integer');
    }
    if (sizeBytes > DRIVE_FILE_MAX_BYTES) {
      return apiErrors.badRequest('File exceeds the 5GB per-file limit');
    }

    // Billed to the workspace owner, same as every other Drive/asset upload rail.
    const quotaError = await enforceStorageQuota(access.workspace.ownerId, sizeBytes);
    if (quotaError) return quotaError;

    const objectKey = driveObjectKey(fileName);

    const rawPartCount = Number(body?.partCount);
    const wantsMultipart = Number.isInteger(rawPartCount) && rawPartCount > 1;
    if (wantsMultipart && rawPartCount > DRIVE_MAX_PARTS) {
      return apiErrors.badRequest(`partCount must be ${DRIVE_MAX_PARTS} or fewer`);
    }

    if (wantsMultipart) {
      const uploadId = await createMultipartFileUpload(objectKey, contentType);
      const partUrls = await Promise.all(
        Array.from({ length: rawPartCount }, (_, i) =>
          presignVideoUploadPart(objectKey, uploadId, i + 1)
        )
      );
      const response = successResponse({
        objectKey,
        contentType,
        displayName: fileName,
        uploadId,
        partUrls,
        presignedPutUrl: null,
      });
      return withCacheControl(response, 'private, no-store');
    }

    const presignedPutUrl = await createPresignedFilePutUrl(objectKey, contentType, sizeBytes);
    const response = successResponse({
      objectKey,
      contentType,
      displayName: fileName,
      uploadId: null,
      partUrls: null,
      presignedPutUrl,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to init a team drive upload:', error);
    return apiErrors.internalError('Failed to start the upload');
  }
}
