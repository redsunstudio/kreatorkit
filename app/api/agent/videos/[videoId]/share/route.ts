import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST /api/agent/videos/[videoId]/share — ensure a public COMMENT review link
// exists for the video and return its URL. Reuses the newest existing COMMENT
// link (does not rotate its token); creates one only when none exists. Mirrors
// the session share route defaults: guests allowed, downloads off, no password.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: { id: true, projectId: true },
    });
    if (!video) return apiErrors.notFound('Video');

    let link = await db.shareLink.findFirst({
      where: { projectId: video.projectId, videoId: video.id, permission: 'COMMENT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true },
    });

    if (!link) {
      link = await db.shareLink.create({
        data: {
          token: randomBytes(24).toString('base64url'),
          projectId: video.projectId,
          videoId: video.id,
          permission: 'COMMENT',
          allowGuests: true,
          allowDownloads: false,
        },
        select: { id: true, token: true },
      });
    }

    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
    const response = successResponse({
      shareUrl: `${base}/watch/${video.id}?shareToken=${link.token}`,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('agent share-link ensure failed:', error);
    return apiErrors.internalError('Failed to ensure share link');
  }
}
