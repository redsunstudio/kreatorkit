import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import {
  createPresignedFilePutUrl,
  getR2FileObjectMetadata,
  safeUploadContentType,
} from '@/lib/r2';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

const MAX_BYTES = BigInt(5 * 1024 * 1024 * 1024);

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
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('files are capped at 5GB');
      }
      const objectKey = `files/${randomUUID()}-${fileName}`;
      const presignedPutUrl = await createPresignedFilePutUrl(objectKey, contentType, sizeBytes);
      return withCacheControl(
        successResponse({ presignedPutUrl, objectKey, contentType, displayName: fileName }),
        'private, no-store'
      );
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

    return apiErrors.badRequest('Provide init or commit');
  } catch (error) {
    logError('agent asset upload failed:', error);
    return apiErrors.internalError('Failed to attach the file');
  }
}
