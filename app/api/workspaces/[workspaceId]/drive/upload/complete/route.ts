import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
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
  driveFileDTO,
  sanitizeDriveFileName,
} from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// POST /api/workspaces/[id]/drive/upload/complete  { objectKey, uploadId?, displayName?, folderId? }
// Finalizes a team-initiated Drive upload. The size is re-derived from the
// STORED object rather than trusted from the client — same convention the
// anonymous grab-link path enforces, kept uniform even for a signed-in
// team member.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'drive-upload-complete');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

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
        logError('Team drive multipart completion failed:', error);
        await abortMultipartVideoUpload(objectKey, uploadId).catch(() => {});
        return apiErrors.badRequest('Upload could not be completed — please try again');
      }
    }

    const head = await getR2FileObjectMetadata(objectKey);
    if (!head || head.contentLength <= BigInt(0)) {
      return apiErrors.badRequest('Uploaded file not found — upload it first, then finalize');
    }

    const quotaError = await enforceStorageQuota(access.workspace.ownerId, BigInt(0));
    if (quotaError) {
      await deleteR2Object(objectKey).catch(() => {});
      return quotaError;
    }

    const rawFolderId = typeof body?.folderId === 'string' ? body.folderId.trim() : '';
    let folderId: string | null = null;
    if (rawFolderId) {
      const folder = await db.workspaceUploadFolder.findFirst({
        where: { id: rawFolderId, workspaceId: id },
        select: { id: true },
      });
      if (!folder) return apiErrors.badRequest('folderId does not belong to this workspace');
      folderId = folder.id;
    }

    const storedName = objectKey.slice(objectKey.indexOf('-') + 1);
    const displayName = sanitizeDriveFileName(
      typeof body?.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : storedName
    );

    const session = await auth();
    const uploaderName = session?.user?.name
      ? session.user.name.slice(0, DRIVE_UPLOADER_NAME_MAX)
      : null;

    const created = await db.workspaceUpload.create({
      data: {
        workspaceId: id,
        folderId,
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
        folder: { select: { id: true, name: true } },
      },
    });

    const response = successResponse({ file: driveFileDTO(created) }, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to complete a team drive upload:', error);
    return apiErrors.internalError('Failed to save the upload');
  }
}
