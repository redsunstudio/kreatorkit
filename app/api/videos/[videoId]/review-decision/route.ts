import { NextRequest } from 'next/server';
import { auth, computeProjectAccess, projectAccessInclude } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { packagingErrorMessage, packagingState } from '@/lib/video-packaging';
import { rateLimit } from '@/lib/rate-limit';
import { validateShareLinkAccess } from '@/lib/share-links';
import { getShareSessionFromRequest } from '@/lib/share-session';
import { notifyUsers } from '@/lib/notifications';
import { teamUserIds } from '@/lib/review-notify';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST /api/videos/[videoId]/review-decision { decision, name? }
// The reviewer's verdict from the watch page:
//   'approve'         -> APPROVED (signed off, ready for upload)
//   'request-changes' -> EDITING  (review round done, back to the editor)
// Clients usually review via a share link, so a share session with COMMENT
// permission counts the same as workspace membership here.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;
    const session = await auth();
    const { videoId } = await params;

    const body = await request.json().catch(() => null);
    const decision = body?.decision;
    if (decision !== 'approve' && decision !== 'request-changes') {
      return apiErrors.badRequest("decision must be 'approve' or 'request-changes'");
    }

    const video = await db.video.findUnique({
      where: { id: videoId },
      include: { project: { include: projectAccessInclude(session?.user?.id) } },
    });
    if (!video) return apiErrors.notFound('Video');

    const access = computeProjectAccess(video.project, session?.user?.id);
    const shareSession = getShareSessionFromRequest(request, video.id);
    const shareAccess = shareSession
      ? await validateShareLinkAccess({
          token: shareSession.token,
          projectId: video.projectId,
          videoId: video.id,
          requiredPermission: 'COMMENT',
          passwordVerified: shareSession.passwordVerified,
        })
      : { hasAccess: false, canComment: false, allowGuests: false };

    const canDecide =
      access.hasAccess ||
      (shareAccess.canComment && (session?.user?.id ? true : shareAccess.allowGuests));
    if (!canDecide) return apiErrors.forbidden('Access denied');

    if (video.status === 'ARCHIVED' || video.status === 'PUBLISHED') {
      return apiErrors.badRequest('This item is no longer in review');
    }
    if (decision === 'approve' && video.status === 'APPROVED') {
      return withCacheControl(successResponse({ status: video.status }), 'private, no-store');
    }

    const rawName = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const actorName = session?.user?.name || session?.user?.email || rawName || 'A reviewer';

    // Approving from the review page runs the same packaging back stop as the
    // item page. "Send back to editor" is never blocked — that direction is how
    // you FIX an item, so refusing it would trap the thing you want to unstick.
    if (decision === 'approve') {
      const packaging = packagingState(video);
      if (!packaging.confirmed) {
        return apiErrors.badRequest(packagingErrorMessage(packaging, 'APPROVED'));
      }
    }

    const nextStatus = decision === 'approve' ? 'APPROVED' : 'EDITING';
    await db.video.update({ where: { id: videoId }, data: { status: nextStatus } });
    await db.videoNote.create({
      data: {
        videoId,
        body:
          decision === 'approve'
            ? `✅ Approved by ${actorName} — ready for upload`
            : `🔁 Review completed by ${actorName} — sent back to the editor for the next version`,
      },
    });

    // Tell the whole team (owner + workspace admins), minus whoever decided.
    const team = (await teamUserIds(video.project.ownerId, video.project.workspaceId)).filter(
      (id) => id !== session?.user?.id
    );
    if (team.length > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
      notifyUsers(team, {
        type: 'approval_action',
        projectName: video.project.name,
        videoTitle: video.title,
        versionLabel: '',
        actorName,
        action: decision === 'approve' ? 'approved' : 'rejected',
        note:
          decision === 'approve'
            ? 'Approved from the review page — ready for upload.'
            : 'Review round complete — item moved back to EDITING for the next version.',
        url: `${baseUrl}/watch/${videoId}`,
      }).catch((err) => logError('review decision notification failed:', err));
    }

    return withCacheControl(successResponse({ status: nextStatus }), 'private, no-store');
  } catch (error) {
    logError('review decision failed:', error);
    return apiErrors.internalError('Could not record the review decision');
  }
}
