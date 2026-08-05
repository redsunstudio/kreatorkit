import { VideoProxyStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { logError } from '@/lib/logger';
import { PROXY_LADDER, proxyQualityLabel } from '@/lib/video-proxy-shared';

// Server-side proxy queue helpers. The vocabulary (ladder, labels, playback
// preference) lives in video-proxy-shared so client components can import it
// without dragging Prisma into the browser bundle.
export * from '@/lib/video-proxy-shared';

/**
 * Queue the ladder for a freshly committed cut. Fire-and-forget on purpose: a
 * transcode that never got queued must not fail the upload the editor just
 * waited on. The worker probes the source and marks rungs above it SKIPPED.
 */
export async function enqueueProxyJobs(versionId: string, providerId: string): Promise<void> {
  if (providerId !== 'r2') return; // only cuts stored in our own bucket
  try {
    await db.videoProxy.createMany({
      data: PROXY_LADDER.map((height) => ({ versionId, height })),
      skipDuplicates: true,
    });
  } catch (error) {
    logError('Failed to queue proxy transcodes:', error);
  }
}

export type ProxyOption = {
  id: string;
  height: number;
  label: string;
  sizeBytes: string;
};

type ProxyRow = {
  id: string;
  height: number;
  status: VideoProxyStatus;
  objectKey: string | null;
  sizeBytes: bigint;
};

/** Ready rungs, biggest first — the shape both the player and the download menu render. */
export function toProxyOptions(rows: ProxyRow[]): ProxyOption[] {
  return rows
    .filter((row) => row.status === VideoProxyStatus.READY && row.objectKey)
    .sort((a, b) => b.height - a.height)
    .map((row) => ({
      id: row.id,
      height: row.height,
      label: proxyQualityLabel(row.height),
      sizeBytes: row.sizeBytes.toString(),
    }));
}
