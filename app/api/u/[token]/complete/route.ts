import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import {
  abortMultipartVideoUpload,
  completeMultipartVideoUpload,
  deleteR2Object,
  getR2FileObjectMetadata,
} from '@/lib/r2';
import { enforceStorageQuota } from '@/lib/storage-quota';
import {
  DRIVE_OBJECT_KEY_RE,
  DRIVE_UPLOADER_NAME_MAX,
  checkLinkUsable,
  driveFileDTO,
  findUsableLink,
  sanitizeDriveFileName,
} from '@/lib/workspace-drive';

type RouteParams = { params: Promise<{ token: string }> };

// POST /api/u/[token]/complete  { objectKey, uploadId?, uploaderName?, displayName? }
// Finalizes a grab-link upload into a Drive row. The size is read back off the
// STORED object rather than trusted from the client — an unauthenticated caller
// must not be able to declare its own footprint.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'drive-upload-complete');
    if (limited) return limited;

    const { token } = await params;
    const link = await findUsableLink(token);
    if (!link) return apiErrors.notFound('Link');
    const usable = checkLinkUsable(link);
    if (!usable.ok) return apiErrors.forbidden('This upload link is no longer active');

    const body = await request.json().catch(() => null);
    const objectKey = typeof body?.objectKey === 'string' ? body.objectKey.trim() : '';
    if (!DRIVE_OBJECT_KEY_RE.test(objectKey)) {
      return apiErrors.badRequest('objectKey must reference an uploaded file');
    }

    const uploadId = typeof body?.uploadId === 'string' ? body.uploadId.trim() : '';
    if (uploadId) {
      try {
        await completeMultipartVideoUpload(objectKey, uploadId);
      } catch (error) {
        logError('Drive multipart completion failed:', error);
        await abortMultipartVideoUpload(objectKey, uploadId).catch(() => {});
        return apiErrors.badRequest('Upload could not be completed — please try again');
      }
    }

    const head = await getR2FileObjectMetadata(objectKey);
    if (!head || head.contentLength <= BigInt(0)) {
      return apiErrors.badRequest('Uploaded file not found — upload it first, then finalize');
    }

    // Re-check against the real stored size. If the object overshoots the quota it
    // is removed rather than left orphaned in the bucket.
    const quotaError = await enforceStorageQuota(link.workspace.ownerId, BigInt(0));
    if (quotaError) {
      await deleteR2Object(objectKey).catch(() => {});
      return quotaError;
    }

    const storedName = objectKey.slice(objectKey.indexOf('-') + 1);
    const displayName = sanitizeDriveFileName(
      typeof body?.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : storedName
    );
    const uploaderName =
      typeof body?.uploaderName === 'string' && body.uploaderName.trim()
        ? body.uploaderName.trim().slice(0, DRIVE_UPLOADER_NAME_MAX)
        : null;

    const created = await db.workspaceUpload.create({
      data: {
        workspaceId: link.workspaceId,
        linkId: link.id,
        objectKey,
        displayName,
        contentType: head.contentType ?? 'application/octet-stream',
        sizeBytes: head.contentLength,
        uploaderName,
      },
      select: {
        id: true,
        displayName: true,
        contentType: true,
        sizeBytes: true,
        uploaderName: true,
        createdAt: true,
      },
    });

    const response = successResponse({ file: driveFileDTO(created) }, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to complete a drive upload:', error);
    return apiErrors.internalError('Failed to save the upload');
  }
}
