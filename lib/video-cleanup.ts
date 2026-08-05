import { db } from '@/lib/db';
import { deleteMediaFilesBestEffort } from '@/lib/r2-cleanup';
import { deleteR2Object } from '@/lib/r2';
import { logError } from '@/lib/logger';

export type CleanupResult =
  | { ok: true; assetsCleared: number; versionsCleared: number; keptVersion: number | null }
  | { ok: false; error: 'not_found' | 'bad_status' };

export const CLEANUP_STATUSES = ['PUBLISHED', 'ARCHIVED', 'REJECTED'] as const;

// Housekeeping: frees storage for a finished (published/archived/rejected)
// video. Deletes every asset except the item's thumbnail, and the stored files
// of every version except the kept (active/latest) cut. Version records for
// the kept cut, its comments, the brief and the thumbnail all remain. The
// status is untouched — a Published item stays Published (tracking intact),
// it just stops paying for old cut files.
export async function cleanupVideoStorage(videoId: string): Promise<CleanupResult> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      versions: { orderBy: { versionNumber: 'desc' } },
      assets: true,
    },
  });
  if (!video) return { ok: false, error: 'not_found' };

  if (!(CLEANUP_STATUSES as readonly string[]).includes(video.status)) {
    return { ok: false, error: 'bad_status' };
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

  const clearedVersionIds: string[] = [];
  for (const version of video.versions) {
    if (keptVersion && version.id === keptVersion.id) continue;
    if (version.providerId === 'r2') {
      if (version.originalUrl) proxyUrlsToDelete.push(version.originalUrl);
      if (version.thumbnailUrl?.startsWith('/api/upload/image/')) {
        proxyUrlsToDelete.push(version.thumbnailUrl);
      }
    }
    clearedVersionIds.push(version.id);
    versionsCleared += 1;
  }

  // Proxy renditions of the cuts being cleared go with them (their rows cascade
  // on the version delete below, so collect the keys first).
  if (clearedVersionIds.length > 0) {
    const proxies = await db.videoProxy.findMany({
      where: { versionId: { in: clearedVersionIds }, objectKey: { not: null } },
      select: { objectKey: true },
    });
    for (const proxy of proxies) {
      if (proxy.objectKey) proxyUrlsToDelete.push(proxy.objectKey);
    }
  }

  // DB: remove asset rows (except thumbnail) and ALL version rows except the
  // kept cut. Comments on removed versions go with them; the kept cut's
  // comments, the brief and the thumbnail remain.
  await db.videoAsset.deleteMany({
    where: {
      videoId,
      ...(thumbnailAssetId ? { id: { not: thumbnailAssetId } } : {}),
    },
  });
  if (keptVersion) {
    await db.videoVersion.deleteMany({
      where: { videoParentId: videoId, id: { not: keptVersion.id } },
    });
    await db.videoVersion.update({
      where: { id: keptVersion.id },
      data: { isActive: true },
    });
  }
  await db.video.update({
    where: { id: videoId },
    data: { storageClearedAt: new Date() },
  });

  // Storage cleanup, best effort.
  if (proxyUrlsToDelete.length > 0) {
    await deleteMediaFilesBestEffort(proxyUrlsToDelete);
  }
  for (const key of fileKeysToDelete) {
    try {
      await deleteR2Object(key);
    } catch (e) {
      logError('cleanup: failed deleting file object', e);
    }
  }

  return {
    ok: true,
    assetsCleared,
    versionsCleared,
    keptVersion: keptVersion?.versionNumber ?? null,
  };
}
