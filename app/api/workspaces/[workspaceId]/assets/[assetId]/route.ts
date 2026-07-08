import { NextRequest, NextResponse } from 'next/server';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { createPresignedFileGetUrl, deleteR2Object } from '@/lib/r2';
import { proxyR2MediaObject } from '@/lib/r2-media-proxy';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string; assetId: string }>;
}

// GET — download (302 presigned) or inline preview (?inline=1)
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();
    const { workspaceId, assetId } = await params;

    const asset = await db.workspaceAsset.findFirst({
      where: { id: assetId, workspaceId },
      include: { workspace: { select: { id: true, ownerId: true } } },
    });
    if (!asset) return apiErrors.notFound('Asset');
    const access = await checkWorkspaceAccess(
      { id: asset.workspace.id, ownerId: asset.workspace.ownerId },
      session.user.id
    );
    if (!access.hasAccess) return apiErrors.forbidden('Access denied');

    if (request.nextUrl.searchParams.get('inline') === '1') {
      return proxyR2MediaObject({
        request,
        key: asset.objectKey,
        fallbackContentType: asset.contentType || 'application/octet-stream',
        cacheControl: 'private, max-age=300',
        extraHeaders: { 'X-Content-Type-Options': 'nosniff' },
        internalErrorMessage: 'Failed to retrieve asset',
      });
    }
    const url = await createPresignedFileGetUrl(asset.objectKey, asset.displayName);
    return NextResponse.redirect(url, 302);
  } catch (error) {
    logError('workspace asset download failed:', error);
    return apiErrors.internalError('Failed to retrieve the asset');
  }
}

// DELETE — remove from the library (admins)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();
    const { workspaceId, assetId } = await params;

    const asset = await db.workspaceAsset.findFirst({
      where: { id: assetId, workspaceId },
      include: { workspace: { select: { id: true, ownerId: true } } },
    });
    if (!asset) return apiErrors.notFound('Asset');
    const access = await checkWorkspaceAccess(
      { id: asset.workspace.id, ownerId: asset.workspace.ownerId },
      session.user.id
    );
    if (!access.canEdit) return apiErrors.forbidden('Only workspace admins can delete brand assets');

    await db.workspaceAsset.delete({ where: { id: asset.id } });
    try {
      await deleteR2Object(asset.objectKey);
    } catch (e) {
      logError('brand asset object cleanup failed:', e);
    }
    return withCacheControl(successResponse({ ok: true }), 'private, no-store');
  } catch (error) {
    logError('workspace asset delete failed:', error);
    return apiErrors.internalError('Failed to delete the asset');
  }
}
