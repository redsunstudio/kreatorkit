import { NextRequest } from 'next/server';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST — the client's sign-off. ANY workspace member can approve (that's the
// point: review happens in KreatorKit, not in Zernio), and it's recorded as a
// note on the item. Publishing a post is impossible without this.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        status: true,
        project: { select: { workspace: { select: { id: true, ownerId: true } } } },
      },
    });
    if (!video) return apiErrors.notFound('Video');
    const access = await checkWorkspaceAccess(video.project.workspace, session.user.id);
    if (!access.hasAccess) return apiErrors.forbidden('Access denied');
    if (video.status === 'ARCHIVED')
      return apiErrors.badRequest('Archived items cannot be approved');
    if (video.status === 'APPROVED' || video.status === 'PUBLISHED') {
      return withCacheControl(successResponse({ status: video.status }), 'private, no-store');
    }

    // No packaging gate here. Approving is a statement about the CUT, and the
    // board has to be able to say so whatever state the packaging is in. The
    // sign-off is enforced on the push to YouTube instead (lib/publish-video).
    await db.video.update({ where: { id: videoId }, data: { status: 'APPROVED' } });
    await db.videoNote.create({
      data: {
        videoId,
        body: `✅ Approved by ${session.user.name || session.user.email || 'a workspace member'}`,
      },
    });
    return withCacheControl(successResponse({ status: 'APPROVED' }), 'private, no-store');
  } catch (error) {
    logError('approve failed:', error);
    return apiErrors.internalError('Could not approve');
  }
}
