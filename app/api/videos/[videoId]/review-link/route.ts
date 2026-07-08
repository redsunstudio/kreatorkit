import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST — mint (or reuse) the public review link for a post item.
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
        projectId: true,
        project: { select: { workspace: { select: { id: true, ownerId: true } } } },
      },
    });
    if (!video) return apiErrors.notFound('Video');
    const access = await checkWorkspaceAccess(video.project.workspace, session.user.id);
    if (!access.canEdit) return apiErrors.forbidden('Workspace admins only');

    let link = await db.shareLink.findFirst({
      where: { projectId: video.projectId, videoId: video.id, permission: 'VIEW' },
    });
    if (!link) {
      link = await db.shareLink.create({
        data: {
          token: randomBytes(24).toString('base64url'),
          projectId: video.projectId,
          videoId: video.id,
          permission: 'VIEW',
          allowGuests: true,
        },
      });
    }
    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
    return withCacheControl(
      successResponse({ url: `${base}/p/${link.token}` }),
      'private, no-store'
    );
  } catch (error) {
    logError('review link failed:', error);
    return apiErrors.internalError('Could not create the review link');
  }
}
