import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { createPresignedFilePutUrl, safeUploadContentType } from '@/lib/r2';
import { isS3VideoUploadsEnabled } from '@/lib/feature-flags';
import { logError } from '@/lib/logger';
import { enforceStorageQuota } from '@/lib/storage-quota';
import { getVideoAssetAccessContext } from '@/lib/video-assets';

type RouteParams = { params: Promise<{ videoId: string }> };

const MAX_FILE_BYTES = BigInt(5 * 1024 * 1024 * 1024); // S3 single-PUT cap

function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.\.+/g, '.');
  return base.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 160) || 'file';
}

// POST /api/videos/[videoId]/assets/file-init
// KreatorKit footage handoff: presign an upload for ANY file type (raw footage,
// stills, audio, PDFs, project files). Finalized via POST ../assets with
// provider R2_FILE — no media probe, generic download-only serving.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'asset-r2-init');
    if (limited) return limited;

    const { videoId } = await params;
    const context = await getVideoAssetAccessContext(request, videoId, 'COMMENT');
    if (!context) return apiErrors.notFound('Video');
    if (!context.canUploadAssets) return apiErrors.forbidden('Access denied');
    if (!context.viewerUserId) {
      return apiErrors.unauthorized('Sign in is required for file uploads');
    }
    if (!isS3VideoUploadsEnabled()) {
      return apiErrors.badRequest('Direct uploads are disabled by this host');
    }

    const body = await request.json().catch(() => null);
    const fileName =
      typeof body?.fileName === 'string' ? sanitizeFileName(body.fileName.trim()) : '';
    const contentTypeInput = safeUploadContentType(
      typeof body?.contentType === 'string' && body.contentType.trim()
        ? body.contentType.trim()
        : 'application/octet-stream'
    );
    if (!fileName) return apiErrors.badRequest('fileName is required');

    let sizeBytes: bigint;
    try {
      sizeBytes = BigInt(body?.sizeBytes);
      if (sizeBytes <= BigInt(0)) throw new Error('non-positive');
    } catch {
      return apiErrors.badRequest('sizeBytes must be a positive integer');
    }
    if (sizeBytes > MAX_FILE_BYTES) {
      return apiErrors.badRequest('File exceeds the 5GB per-file limit');
    }

    const billedUserId = context.video.project.workspace.ownerId;
    const quotaError = await enforceStorageQuota(billedUserId, sizeBytes);
    if (quotaError) return quotaError;

    const objectKey = `files/${randomUUID()}-${fileName}`;
    const presignedPutUrl = await createPresignedFilePutUrl(objectKey, contentTypeInput, sizeBytes);

    const response = successResponse({
      presignedPutUrl,
      objectKey,
      contentType: contentTypeInput,
      displayName: fileName,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error initializing file asset upload:', error);
    return apiErrors.internalError('Failed to initialize upload');
  }
}
