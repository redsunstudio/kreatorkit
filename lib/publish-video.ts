// Publish a KreatorKit video to YouTube through Zernio.
// The active cut is copied from our storage into Zernio's media store, then a
// post is created against the workspace's wired YouTube account. Default is a
// Zernio DRAFT (thumbnails need a manual confirm in the Zernio UI before
// publish — the API-set thumbnail does not reliably stick).

import { db } from '@/lib/db';
import { createPresignedFileGetUrl, createPresignedVideoGetUrl } from '@/lib/r2';
import { isZernioConfigured, zernioCreatePost, zernioUploadFromUrl } from '@/lib/zernio';
import type { ZernioMediaItem } from '@/lib/zernio';

export class PublishError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
  }
}

export function workspaceYouTubeAccountId(publishing: unknown): string | null {
  if (!publishing || typeof publishing !== 'object') return null;
  const zernio = (publishing as Record<string, unknown>).zernio;
  if (!zernio || typeof zernio !== 'object') return null;
  const accountId = (zernio as Record<string, unknown>).youtubeAccountId;
  return typeof accountId === 'string' && accountId ? accountId : null;
}

function guessImageContentType(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

export interface PublishResult {
  mode: 'draft' | 'published';
  postId: string | null;
  accountId: string;
  thumbnailAttached: boolean;
}

export async function publishVideoToYouTube(
  videoId: string,
  opts: { publishNow?: boolean; actorName?: string } = {}
): Promise<PublishResult> {
  if (!isZernioConfigured()) {
    throw new PublishError(
      'Publishing is not configured on the server (ZERNIO_API_KEY missing)',
      503
    );
  }

  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      project: {
        select: { workspace: { select: { id: true, name: true, publishing: true } } },
      },
      versions: { where: { isActive: true }, orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  });
  if (!video) throw new PublishError('Video not found', 404);

  const accountId = workspaceYouTubeAccountId(video.project.workspace.publishing);
  if (!accountId) {
    throw new PublishError(
      'No YouTube account is wired to this workspace yet — set publishing.zernio.youtubeAccountId'
    );
  }

  const cut = video.versions[0];
  if (!cut || cut.providerId !== 'r2' || !cut.videoId) {
    throw new PublishError('No uploaded cut to publish — upload the final cut first');
  }

  const safeName = video.title.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'video';
  const sourceUrl = await createPresignedVideoGetUrl(cut.videoId, `${safeName}.mp4`, 6 * 3600);
  const mediaUrl = await zernioUploadFromUrl(
    sourceUrl,
    `${safeName}.mp4`,
    'video/mp4',
    cut.sizeBytes ? Number(cut.sizeBytes) : undefined
  );

  // Best-effort thumbnail copy (item thumbnails are stored as R2_FILE assets).
  let thumbnailUrl: string | undefined;
  const thumbMatch = video.thumbnailUrl?.match(
    /^\/api\/videos\/[A-Za-z0-9]+\/assets\/([A-Za-z0-9]+)\/download/
  );
  if (thumbMatch) {
    try {
      const asset = await db.videoAsset.findUnique({ where: { id: thumbMatch[1] } });
      if (asset?.provider === 'R2_FILE' && asset.sourceUrl.startsWith('files/')) {
        const thumbSource = await createPresignedFileGetUrl(
          asset.sourceUrl,
          asset.displayName,
          3600
        );
        thumbnailUrl = await zernioUploadFromUrl(
          thumbSource,
          asset.displayName,
          guessImageContentType(asset.displayName),
          asset.sizeBytes ? Number(asset.sizeBytes) : undefined
        );
      }
    } catch {
      thumbnailUrl = undefined; // the post still goes out without it
    }
  }

  const mediaItems: ZernioMediaItem[] = [
    { type: 'video', url: mediaUrl, ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}) },
  ];
  const { postId } = await zernioCreatePost({
    content: video.description?.trim() || video.brief?.trim() || video.title,
    mediaItems,
    platforms: [
      {
        platform: 'youtube',
        accountId,
        platformSpecificData: {
          title: video.title,
          visibility: 'public',
          madeForKids: false,
        },
      },
    ],
    ...(opts.publishNow ? { publishNow: true } : { isDraft: true }),
  });

  const mode: PublishResult['mode'] = opts.publishNow ? 'published' : 'draft';
  await db.videoNote.create({
    data: {
      videoId: video.id,
      body:
        mode === 'published'
          ? `🚀 Published to YouTube via Zernio${postId ? ` (post ${postId})` : ''}${opts.actorName ? ` — by ${opts.actorName}` : ''}`
          : `📤 Sent to Zernio as a YouTube draft${postId ? ` (post ${postId})` : ''}${opts.actorName ? ` — by ${opts.actorName}` : ''}. Confirm the thumbnail in Zernio before publishing.`,
    },
  });
  if (mode === 'published') {
    await db.video.update({ where: { id: video.id }, data: { status: 'PUBLISHED' } });
  }

  return { mode, postId, accountId, thumbnailAttached: Boolean(thumbnailUrl) };
}
