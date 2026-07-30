import { NextRequest, NextResponse } from 'next/server';
import { auth, checkProjectAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { validateShareLinkAccess } from '@/lib/share-links';
import { getShareSessionFromRequest } from '@/lib/share-session';
import { apiErrors } from '@/lib/api-response';
import { createPresignedInlineGetUrl, INLINE_REDIRECT_CACHE } from '@/lib/r2';
import { logError } from '@/lib/logger';

// Only allow UUID filenames with safe extensions
const SAFE_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

const CONTENT_TYPE_MAP: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};
function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    // Validate filename to prevent path traversal
    if (!SAFE_FILENAME.test(filename)) {
      return apiErrors.badRequest('Invalid filename');
    }

    // Parallelize the DB lookup and session check to narrow the timing delta
    // between "asset not found" and "asset found, access denied" responses.
    const imageUrl = `/api/upload/image/${filename}`;
    const projectSelect = {
      id: true,
      ownerId: true,
      workspaceId: true,
      visibility: true,
    } as const;
    const videoSelect = {
      id: true,
      projectId: true,
      project: { select: projectSelect },
    } as const;
    const [comments, videoAssets, videoVersions, session] = await Promise.all([
      db.comment.findMany({
        where: { imageUrl },
        take: 2,
        select: {
          version: {
            select: { video: { select: videoSelect } },
          },
        },
      }),
      db.videoAsset.findMany({
        where: { sourceUrl: imageUrl },
        take: 2,
        select: { video: { select: videoSelect } },
      }),
      db.videoVersion.findMany({
        where: { thumbnailUrl: imageUrl },
        take: 2,
        select: { video: { select: videoSelect } },
      }),
      auth(),
    ]);

    const uniqueVideos = new Map<string, (typeof videoAssets)[number]['video']>();
    comments.forEach((comment) => {
      if (comment.version?.video) uniqueVideos.set(comment.version.video.id, comment.version.video);
    });
    videoAssets.forEach((videoAsset) => uniqueVideos.set(videoAsset.video.id, videoAsset.video));
    videoVersions.forEach((videoVersion) =>
      uniqueVideos.set(videoVersion.video.id, videoVersion.video)
    );

    if (uniqueVideos.size > 1) {
      return apiErrors.forbidden('Access denied');
    }

    const video = uniqueVideos.values().next().value ?? null;
    if (!video) {
      return apiErrors.forbidden('Access denied');
    }

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
        : null;

      if (!shareAccess?.hasAccess) {
        return apiErrors.forbidden('Access denied');
      }
    }

    // Redirect to a short-lived presigned URL instead of piping the body
    // through the app — consistent with every other media route after the
    // 2026-07-13 OOM incident. This one was left piping because 10MB is
    // bounded and safe, but there is no cost to bringing it in line, and the
    // browser can now cache the redirect itself instead of re-hitting this
    // route (auth + 3 DB lookups + a fresh presign) on every repeat view.
    const key = `images/${filename}`;
    const presigned = await createPresignedInlineGetUrl(key, getContentType(filename));
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { 'Cache-Control': INLINE_REDIRECT_CACHE },
    });
  } catch (error: unknown) {
    logError('Error serving image:', error);
    return apiErrors.internalError('Failed to retrieve image');
  }
}
