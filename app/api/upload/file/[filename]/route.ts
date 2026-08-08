import { NextRequest, NextResponse } from 'next/server';
import { auth, checkProjectAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { validateShareLinkAccess } from '@/lib/share-links';
import { getShareSessionFromRequest } from '@/lib/share-session';
import { apiErrors } from '@/lib/api-response';
import { createPresignedFileGetUrl } from '@/lib/r2';
import { logError } from '@/lib/logger';

// Only allow UUID filenames with safe extensions
const SAFE_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    if (!SAFE_FILENAME.test(filename)) {
      return apiErrors.badRequest('Invalid filename');
    }

    // Same access model as the comment-image route: the attachment belongs to
    // exactly one video (fileUrl is unique on comments); resolve it and check
    // the viewer can see that video.
    const fileUrl = `/api/upload/file/${filename}`;
    const videoSelect = {
      id: true,
      projectId: true,
      project: {
        select: { id: true, ownerId: true, workspaceId: true, visibility: true },
      },
    } as const;
    const [comments, videoAssets, session] = await Promise.all([
      db.comment.findMany({
        where: { fileUrl },
        take: 2,
        select: {
          fileName: true,
          version: { select: { video: { select: videoSelect } } },
        },
      }),
      db.videoAsset.findMany({
        where: { sourceUrl: fileUrl },
        take: 2,
        select: { displayName: true, video: { select: videoSelect } },
      }),
      auth(),
    ]);

    const uniqueVideos = new Map<string, (typeof videoAssets)[number]['video']>();
    comments.forEach((comment) => {
      if (comment.version?.video) uniqueVideos.set(comment.version.video.id, comment.version.video);
    });
    videoAssets.forEach((videoAsset) => uniqueVideos.set(videoAsset.video.id, videoAsset.video));

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

    // 302 to a short-lived attachment-disposition presign - never pipe bytes
    // through the app, and never serve these inline (arbitrary user content).
    const downloadName = comments[0]?.fileName || videoAssets[0]?.displayName || filename;
    const key = `comment-files/${filename}`;
    const presigned = await createPresignedFileGetUrl(key, downloadName);
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error: unknown) {
    logError('Error serving file:', error);
    return apiErrors.internalError('Failed to retrieve file');
  }
}
