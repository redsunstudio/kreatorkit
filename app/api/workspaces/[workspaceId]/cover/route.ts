import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { createPresignedFilePutUrl, getR2FileObjectMetadata } from '@/lib/r2';
import { REPLACEABLE_MEDIA_CACHE, proxyR2MediaObject } from '@/lib/r2-media-proxy';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

const MAX_COVER_BYTES = BigInt(15 * 1024 * 1024);

// GET /api/workspaces/[workspaceId]/cover — serve the cover art inline
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { workspaceId } = await params;
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerId: true, coverKey: true },
    });
    if (!workspace?.coverKey) return apiErrors.notFound('Cover');
    const access = await checkWorkspaceAccess(
      { id: workspace.id, ownerId: workspace.ownerId },
      session.user.id
    );
    if (!access.hasAccess) return apiErrors.forbidden('Access denied');

    return proxyR2MediaObject({
      request,
      key: workspace.coverKey,
      fallbackContentType: 'image/jpeg',
      cacheControl: REPLACEABLE_MEDIA_CACHE,
      extraHeaders: { 'X-Content-Type-Options': 'nosniff' },
      internalErrorMessage: 'Failed to retrieve cover',
    });
  } catch (error) {
    logError('Error serving workspace cover:', error);
    return apiErrors.internalError('Failed to retrieve cover');
  }
}

// POST /api/workspaces/[workspaceId]/cover
//   { init: {fileName, contentType, sizeBytes} } -> presigned PUT
//   { commit: {objectKey} } -> validates + saves as the workspace cover
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { workspaceId } = await params;
    if (!session?.user?.id) return apiErrors.unauthorized();

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerId: true },
    });
    if (!workspace) return apiErrors.notFound('Workspace');
    const access = await checkWorkspaceAccess(workspace, session.user.id);
    if (!access.canEdit) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);

    if (body?.init) {
      const fileName = typeof body.init.fileName === 'string' ? body.init.fileName : '';
      const contentType =
        typeof body.init.contentType === 'string' && body.init.contentType.startsWith('image/')
          ? body.init.contentType
          : '';
      if (!contentType) return apiErrors.badRequest('The cover needs to be an image');
      let sizeBytes: bigint;
      try {
        sizeBytes = BigInt(body.init.sizeBytes);
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_COVER_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('Cover images are capped at 15MB');
      }
      const ext = (fileName.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5);
      const objectKey = `files/${randomUUID()}-cover.${ext || 'jpg'}`;
      const presignedPutUrl = await createPresignedFilePutUrl(objectKey, contentType, sizeBytes);
      return withCacheControl(
        successResponse({ presignedPutUrl, objectKey, contentType }),
        'private, no-store'
      );
    }

    if (body?.commit) {
      const objectKey = typeof body.commit.objectKey === 'string' ? body.commit.objectKey : '';
      if (!/^files\/[A-Za-z0-9-]{36}-cover\.[A-Za-z0-9]{1,5}$/.test(objectKey)) {
        return apiErrors.badRequest('objectKey must reference an uploaded cover');
      }
      const head = await getR2FileObjectMetadata(objectKey);
      if (!head || head.contentLength <= BigInt(0)) {
        return apiErrors.badRequest('Cover upload not found — upload it first');
      }
      await db.workspace.update({ where: { id: workspaceId }, data: { coverKey: objectKey } });
      return withCacheControl(successResponse({ ok: true }), 'private, no-store');
    }

    return apiErrors.badRequest('Provide init or commit');
  } catch (error) {
    logError('Error setting workspace cover:', error);
    return apiErrors.internalError('Failed to set cover');
  }
}
