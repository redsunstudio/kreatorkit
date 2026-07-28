import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string; linkId: string }> };

// DELETE /api/workspaces/[id]/drive/links/[linkId]
// Revokes rather than deletes: the files the link brought in keep their
// provenance ("came from the March shoot link") and the URL stops working.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { workspaceId: id, linkId } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');
    if (!access.isAdmin) return apiErrors.forbidden('Only workspace admins revoke grab links');

    // Scoped by workspaceId so a link id from another workspace cannot be touched.
    const { count } = await db.workspaceUploadLink.updateMany({
      where: { id: linkId, workspaceId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) return apiErrors.notFound('Link');

    return withCacheControl(successResponse({ ok: true, id: linkId }), 'private, no-store');
  } catch (error) {
    logError('Failed to revoke a grab link:', error);
    return apiErrors.internalError('Failed to revoke the grab link');
  }
}
