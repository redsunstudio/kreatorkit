import { NextRequest } from 'next/server';
import { VideoStatus, VideoType } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { createPresignedFileGetUrl, createPresignedVideoGetUrl } from '@/lib/r2';
import { collectVideoMediaUrls, deleteMediaFilesBestEffort } from '@/lib/r2-cleanup';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// GET /api/agent/videos/[videoId] — full item detail for automation:
// versions with presigned downloads (1h), assets with presigned downloads,
// review share URL when one exists.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      include: {
        project: { select: { id: true, workspaceId: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
        assets: true,
        shareLinks: { orderBy: { createdAt: 'desc' }, take: 1, select: { token: true } },
      },
    });
    if (!video) return apiErrors.notFound('Video');

    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
    const shareToken = video.shareLinks[0]?.token ?? null;

    const versions = await Promise.all(
      video.versions.map(async (v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        versionLabel: v.versionLabel,
        isActive: v.isActive,
        sizeBytes: v.sizeBytes?.toString() ?? null,
        downloadUrl:
          v.providerId === 'r2' && v.videoId
            ? await createPresignedVideoGetUrl(
                v.videoId,
                `${video.title.replace(/[^A-Za-z0-9 _-]/g, '')}-v${v.versionNumber}.mp4`
              ).catch(() => null)
            : null,
      }))
    );

    const assets = await Promise.all(
      video.assets.map(async (a) => ({
        id: a.id,
        displayName: a.displayName,
        kind: a.kind,
        provider: a.provider,
        sizeBytes: a.sizeBytes?.toString() ?? null,
        downloadUrl:
          a.provider === 'R2_FILE' && a.sourceUrl?.startsWith('files/')
            ? await createPresignedFileGetUrl(a.sourceUrl, a.displayName).catch(() => null)
            : `${base}/api/videos/${video.id}/assets/${a.id}/download`,
      }))
    );

    return withCacheControl(
      successResponse({
        id: video.id,
        title: video.title,
        status: video.status,
        videoType: video.videoType,
        brief: video.brief,
        description: video.description,
        thumbnailUrl: video.thumbnailUrl ? `${base}${video.thumbnailUrl}` : null,
        projectId: video.project.id,
        workspaceId: video.project.workspaceId,
        shareUrl: shareToken ? `${base}/watch/${video.id}?shareToken=${shareToken}` : null,
        versions,
        assets,
      }),
      'private, no-store'
    );
  } catch (error) {
    logError('agent video detail failed:', error);
    return apiErrors.internalError('Failed to load the video');
  }
}

// PATCH /api/agent/videos/[videoId] { status?, brief?, description?, videoType? }
// — automation write-back (e.g. mark PUBLISHED after the social pipeline ships it).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const body = await request.json().catch(() => null);
    const status = body?.status;
    const brief = body?.brief;
    const description = body?.description;
    const videoType = body?.videoType;

    if (status !== undefined && !(Object.values(VideoStatus) as string[]).includes(status)) {
      return apiErrors.badRequest('unknown status');
    }
    if (videoType !== undefined && !(Object.values(VideoType) as string[]).includes(videoType)) {
      return apiErrors.badRequest(
        'videoType must be one of ' + Object.values(VideoType).join(', ')
      );
    }
    if (brief !== undefined && brief !== null && typeof brief !== 'string') {
      return apiErrors.badRequest('brief must be a string');
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return apiErrors.badRequest('description must be a string');
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (videoType !== undefined) updateData.videoType = videoType;
    if (brief !== undefined)
      updateData.brief = brief === null ? null : String(brief).trim() || null;
    if (description !== undefined)
      updateData.description = description === null ? null : String(description).trim() || null;
    if (Object.keys(updateData).length === 0) return apiErrors.badRequest('nothing to update');

    const video = await db.video.update({ where: { id: videoId }, data: updateData });
    return withCacheControl(
      successResponse({ id: video.id, status: video.status }),
      'private, no-store'
    );
  } catch (error) {
    logError('agent video patch failed:', error);
    return apiErrors.internalError('Failed to update the video');
  }
}

// DELETE /api/agent/videos/[videoId] — permanent removal (item + files).
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
    if (!video) return apiErrors.notFound('Video');
    const mediaUrls = await collectVideoMediaUrls(videoId);
    await db.video.delete({ where: { id: videoId } });
    if (mediaUrls.length > 0) await deleteMediaFilesBestEffort(mediaUrls);
    return withCacheControl(successResponse({ ok: true, deleted: videoId }), 'private, no-store');
  } catch (error) {
    logError('agent video delete failed:', error);
    return apiErrors.internalError('Failed to delete the video');
  }
}
