import { NextRequest } from 'next/server';
import { auth, checkProjectAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { deleteMediaFilesBestEffort } from '@/lib/r2-cleanup';
import { deleteR2Object } from '@/lib/r2';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ projectId: string; videoId: string }>;
}

// POST /api/projects/[projectId]/videos/[videoId]/archive
// Housekeeping: frees storage for a finished (archived/rejected) video.
// Deletes every asset except the item's thumbnail, and the stored files of
// every version except the kept (active/latest) cut. Version records, their
// comments, the brief and the thumbnail all remain.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { projectId, videoId } = await params;
    if (!session?.user?.id) return apiErrors.unauthorized();

    const video = await db.video.findFirst({
      where: { id: videoId, projectId },
      include: {
        project: true,
        versions: { orderBy: { versionNumber: 'desc' } },
        assets: true,
      },
    });
    if (!video) return apiErrors.notFound('Video');

    const access = await checkProjectAccess(video.project, session.user.id, { intent: 'manage' });
    if (!access.canEdit) return apiErrors.forbidden('Access denied');

    if (video.status !== 'ARCHIVED' && video.status !== 'REJECTED') {
      return apiErrors.badRequest('Only archived or rejected videos can be cleaned up');
    }

    // The cut we keep: the active version, else the latest.
    const keptVersion = video.versions.find((v) => v.isActive) ?? video.versions[0] ?? null;

    // The thumbnail asset survives (referenced by Video.thumbnailUrl).
    const thumbMatch = (video.thumbnailUrl || '').match(/\/assets\/([A-Za-z0-9]+)\/download/);
    const thumbnailAssetId = thumbMatch?.[1] ?? null;

    const proxyUrlsToDelete: string[] = [];
    const fileKeysToDelete: string[] = [];
    let assetsCleared = 0;
    let versionsCleared = 0;

    for (const asset of video.assets) {
      if (thumbnailAssetId && asset.id === thumbnailAssetId) continue;
      if (asset.provider === 'R2_FILE') {
        if (asset.sourceUrl?.startsWith('files/')) fileKeysToDelete.push(asset.sourceUrl);
      } else if (
        asset.provider === 'R2_VIDEO' ||
        asset.provider === 'R2_AUDIO' ||
        asset.provider === 'R2_IMAGE'
      ) {
        if (asset.sourceUrl) proxyUrlsToDelete.push(asset.sourceUrl);
        if (asset.thumbnailUrl) proxyUrlsToDelete.push(asset.thumbnailUrl);
      }
      assetsCleared += 1;
    }

    for (const version of video.versions) {
      if (keptVersion && version.id === keptVersion.id) continue;
      if (version.providerId === 'r2') {
        if (version.originalUrl) proxyUrlsToDelete.push(version.originalUrl);
        if (version.thumbnailUrl?.startsWith('/api/upload/image/')) {
          proxyUrlsToDelete.push(version.thumbnailUrl);
        }
      }
      versionsCleared += 1;
    }

    // DB first: remove asset rows (except thumbnail). Version rows stay so
    // comments and history remain.
    await db.videoAsset.deleteMany({
      where: {
        videoId,
        ...(thumbnailAssetId ? { id: { not: thumbnailAssetId } } : {}),
      },
    });

    // Storage cleanup, best effort.
    if (proxyUrlsToDelete.length > 0) {
      await deleteMediaFilesBestEffort(proxyUrlsToDelete);
    }
    for (const key of fileKeysToDelete) {
      try {
        await deleteR2Object(key);
      } catch (e) {
        logError('archive: failed deleting file object', e);
      }
    }

    const response = successResponse({
      ok: true,
      assetsCleared,
      versionsCleared,
      keptVersion: keptVersion?.versionNumber ?? null,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error archiving video:', error);
    return apiErrors.internalError('Failed to archive the video');
  }
}
