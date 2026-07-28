import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { auth, computeProjectAccess, projectAccessInclude } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { logError } from '@/lib/logger';

type RouteParams = { params: Promise<{ markerId: string }> };

// DELETE /api/markers/[markerId]
// Same gate as planting one: a signed-in member of the workspace. Markers carry no
// history worth keeping, so this is a hard delete.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return apiErrors.unauthorized();

    const { markerId } = await params;
    const marker = await db.videoMarker.findUnique({
      where: { id: markerId },
      include: {
        version: {
          include: {
            video: { include: { project: { include: projectAccessInclude(userId) } } },
          },
        },
      },
    });
    if (!marker) return apiErrors.notFound('Marker');

    const access = computeProjectAccess(marker.version.video.project, userId);
    if (!access.hasAccess) return apiErrors.forbidden('Access denied');

    await db.videoMarker.delete({ where: { id: markerId } });

    const response = successResponse({ ok: true, id: markerId });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to delete a review marker:', error);
    return apiErrors.internalError('Failed to delete the review marker');
  }
}
