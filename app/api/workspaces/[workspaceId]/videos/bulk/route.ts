import { NextRequest } from 'next/server';
import { VideoStatus } from '@prisma/client';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { notifyReviewReady } from '@/lib/review-notify';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

/** One bar-click should never be able to sweep a whole client's board by accident. */
const MAX_BULK_ITEMS = 200;

// POST /api/workspaces/[workspaceId]/videos/bulk
//
// Batch status moves from the pipeline's selection bar. Deliberately status-only:
// moving items to ARCHIVED parks them out of the pipeline but touches no files.
// The destructive archive (which deletes assets and old cuts from storage) stays
// a per-item, individually-confirmed action on the item page.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { workspaceId } = await params;
    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerId: true },
    });
    if (!workspace) return apiErrors.notFound('Workspace');

    const access = await checkWorkspaceAccess(workspace, session.user.id);
    if (!access.canEdit) {
      return apiErrors.forbidden('Access denied');
    }

    const body = await request.json().catch(() => null);
    const rawIds: unknown[] | null = Array.isArray(body?.videoIds) ? body.videoIds : null;
    if (!rawIds || rawIds.length === 0) {
      return apiErrors.badRequest('videoIds must be a non-empty array');
    }
    const videoIds: string[] = [
      ...new Set(rawIds.filter((id: unknown): id is string => typeof id === 'string' && id !== '')),
    ];
    if (videoIds.length === 0) {
      return apiErrors.badRequest('videoIds must be a non-empty array');
    }
    if (videoIds.length > MAX_BULK_ITEMS) {
      return apiErrors.badRequest(`Select ${MAX_BULK_ITEMS} items or fewer`);
    }

    const status = body?.status;
    const VIDEO_STATUSES = Object.values(VideoStatus) as string[];
    if (typeof status !== 'string' || !VIDEO_STATUSES.includes(status)) {
      return apiErrors.badRequest('status must be one of ' + VIDEO_STATUSES.join(', '));
    }
    // Scoped to this workspace: ids from another client's board silently drop out.
    const videos = await db.video.findMany({
      where: { id: { in: videoIds }, project: { workspaceId } },
      select: { id: true, status: true },
    });

    const toUpdate: string[] = [];
    const toNotify: string[] = [];

    for (const video of videos) {
      if (video.status === status) continue; // already there — not a failure
      toUpdate.push(video.id);
      if (status === VideoStatus.REVIEW) toNotify.push(video.id);
    }

    if (toUpdate.length > 0) {
      await db.video.updateMany({
        where: { id: { in: toUpdate } },
        data: { status: status as VideoStatus },
      });
    }

    // Same promise as a single move: reviewers hear about every cut that lands
    // in REVIEW, whether it got there one at a time or twelve at once.
    for (const videoId of toNotify) {
      notifyReviewReady({
        videoId,
        actorUserId: session.user.id,
        actorName: session.user.name,
      }).catch((err) => logError('Notification failed:', err));
    }

    const response = successResponse({
      updated: toUpdate.length,
      unchanged: videos.length - toUpdate.length,
      notFound: videoIds.length - videos.length,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error updating videos in bulk:', error);
    return apiErrors.internalError('Failed to update the selected items');
  }
}
