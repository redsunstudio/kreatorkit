import { NextRequest, NextResponse } from 'next/server';
import { VideoProxyStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { auth, checkProjectAccess } from '@/lib/auth';
import { apiErrors } from '@/lib/api-response';
import { validateShareLinkAccess } from '@/lib/share-links';
import { getShareSessionFromRequest } from '@/lib/share-session';
import { createPresignedProxyInlineGetUrl, INLINE_REDIRECT_CACHE } from '@/lib/r2';
import { logError } from '@/lib/logger';

type RouteParams = { params: Promise<{ versionId: string; height: string }> };

// GET /api/versions/[versionId]/proxy/[height]
//
// Playback source for a proxy rendition. Auth here, bytes from storage: this
// route only ever redirects to a presigned inline URL, exactly like the master
// playback route (piping media through the app OOM'd the container once).
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { versionId, height } = await params;
    const requestedHeight = Number(height);
    if (!Number.isInteger(requestedHeight) || requestedHeight <= 0) {
      return apiErrors.badRequest('Invalid quality');
    }

    const session = await auth();
    const proxy = await db.videoProxy.findFirst({
      where: {
        versionId,
        height: requestedHeight,
        status: VideoProxyStatus.READY,
        objectKey: { not: null },
      },
      select: {
        objectKey: true,
        version: {
          select: {
            video: {
              select: {
                id: true,
                projectId: true,
                project: {
                  select: { id: true, ownerId: true, workspaceId: true, visibility: true },
                },
              },
            },
          },
        },
      },
    });

    if (!proxy?.objectKey) {
      return apiErrors.notFound('Proxy');
    }

    const video = proxy.version.video;
    const access = await checkProjectAccess(video.project, session?.user?.id);
    if (!access.hasAccess) {
      const shareSession = getShareSessionFromRequest(request, video.id);
      const shareAccess = shareSession
        ? await validateShareLinkAccess({
            token: shareSession.token,
            projectId: video.projectId,
            videoId: video.id,
            requiredPermission: 'VIEW',
            passwordVerified: shareSession.passwordVerified,
          })
        : { hasAccess: false };
      if (!shareAccess.hasAccess) {
        return apiErrors.forbidden('Access denied');
      }
    }

    const presigned = await createPresignedProxyInlineGetUrl(proxy.objectKey);
    return NextResponse.redirect(presigned, {
      status: 302,
      // Cached well inside the presign TTL: a review session seeks constantly,
      // and re-signing on every range request is pure latency.
      headers: { 'Cache-Control': INLINE_REDIRECT_CACHE },
    });
  } catch (error) {
    logError('Error serving proxy:', error);
    return apiErrors.internalError('Failed to load the proxy');
  }
}
