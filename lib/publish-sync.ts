// Published-video sync: for every PUBLISHED item in a workspace, pull the
// YouTube URL + analytics snapshot from Zernio (using the workspace's own key).
// Runs lazily when the Published tab is viewed and data is stale (>20h), and
// on demand via the agent API — John's "sync every ~24 hours".

import { db } from '@/lib/db';
import { workspaceZernioConfig } from '@/lib/publish-video';
import { zernioGetPostAnalytics, zernioGetPostInfo } from '@/lib/zernio';
import { logError } from '@/lib/logger';

const STALE_AFTER_MS = 20 * 60 * 60 * 1000;

export function isPublishDataStale(video: {
  publishedUrl: string | null;
  publishStatsAt: Date | null;
}): boolean {
  if (!video.publishedUrl) return true;
  if (!video.publishStatsAt) return true;
  return Date.now() - video.publishStatsAt.getTime() > STALE_AFTER_MS;
}

/** Adopt Zernio post ids recorded in publish notes before the column existed. */
async function backfillPostId(videoId: string): Promise<string | null> {
  const notes = await db.videoNote.findMany({
    where: { videoId },
    orderBy: { createdAt: 'desc' },
    select: { body: true },
  });
  for (const n of notes) {
    const m = n.body.match(/Zernio post ([a-f0-9]{24})/);
    if (m) {
      await db.video.update({ where: { id: videoId }, data: { zernioPostId: m[1] } });
      return m[1];
    }
  }
  return null;
}

export async function syncPublishedVideos(
  workspaceId: string,
  opts: { force?: boolean } = {}
): Promise<{ synced: number; skipped: number }> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { publishing: true },
  });
  const apiKey = workspace ? workspaceZernioConfig(workspace.publishing).apiKey : undefined;
  if (!apiKey) return { synced: 0, skipped: 0 };

  const videos = await db.video.findMany({
    where: { status: 'PUBLISHED', project: { workspaceId } },
    select: {
      id: true,
      zernioPostId: true,
      publishedUrl: true,
      publishStatsAt: true,
    },
  });

  let synced = 0;
  let skipped = 0;
  for (const v of videos) {
    try {
      if (!opts.force && !isPublishDataStale(v)) {
        skipped++;
        continue;
      }
      const postId = v.zernioPostId ?? (await backfillPostId(v.id));
      if (!postId) {
        skipped++;
        continue;
      }
      const info = await zernioGetPostInfo(postId, apiKey).catch(() => null);
      const stats = await zernioGetPostAnalytics(postId, apiKey).catch(() => null);
      await db.video.update({
        where: { id: v.id },
        data: {
          ...(info?.platformPostUrl ? { publishedUrl: info.platformPostUrl } : {}),
          ...(stats ? { publishStats: stats } : {}),
          publishStatsAt: new Date(),
        },
      });
      synced++;
    } catch (e) {
      logError('published sync failed for video ' + v.id + ':', e);
      skipped++;
    }
  }
  return { synced, skipped };
}
