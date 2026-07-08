// BETA: push a written POST item to LinkedIn through Zernio.
// The post copy lives in Video.description; media comes from the item's
// uploaded assets — first video wins, else images become a carousel (max 9),
// else a PDF becomes a document post, else text-only. Media is always copied
// into Zernio's store (posts are usually drafted/scheduled, outliving presigns).
// Tags typed as @mentions are confirmed in the Zernio editor before posting.

import { db } from '@/lib/db';
import { createPresignedFileGetUrl, createPresignedVideoGetUrl } from '@/lib/r2';
import { mediaUrlToKey } from '@/lib/r2-cleanup';
import { PublishError, workspaceZernioConfig } from '@/lib/publish-video';
import { zernioCreatePost, zernioListAccounts, zernioUploadFromUrl } from '@/lib/zernio';
import type { ZernioMediaItem } from '@/lib/zernio';

export type PostPublishMode = 'draft' | 'live';

function guessImageContentType(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

export interface PostPublishResult {
  mode: PostPublishMode | 'scheduled';
  postId: string | null;
  accountId: string;
  mediaKind: 'video' | 'images' | 'document' | 'text';
  mediaCount: number;
}

export async function publishPostToLinkedIn(
  videoId: string,
  opts: { mode?: PostPublishMode; scheduledFor?: string; actorName?: string } = {}
): Promise<PostPublishResult> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      project: { select: { workspace: { select: { id: true, publishing: true } } } },
      assets: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!video) throw new PublishError('Post not found', 404);
  if (video.videoType !== 'POST') throw new PublishError('This item is not a post');

  const cfg = workspaceZernioConfig(video.project.workspace.publishing);
  const apiKey = cfg.apiKey;
  if (!apiKey) {
    throw new PublishError(
      'This workspace has no Zernio API key — add its own key in Settings → YouTube publishing',
      503
    );
  }
  if (!cfg.linkedinAccountId) {
    throw new PublishError(
      'No LinkedIn profile is wired to this workspace yet — pick it in Settings → Publishing'
    );
  }

  const copy = video.description?.trim();
  if (!copy) throw new PublishError('Not ready to post — write the post copy first');

  // The client reviews IN KreatorKit — nothing reaches Zernio or LinkedIn
  // until the item carries their sign-off.
  if (video.status !== 'APPROVED' && video.status !== 'PUBLISHED') {
    throw new PublishError(
      'Not approved yet — the post needs sign-off (✅ Approve) before it goes anywhere'
    );
  }

  // Isolation guard (same rule as YouTube): the wired profile must be visible
  // to this workspace's own key.
  const visible = await zernioListAccounts(apiKey).catch(() => null);
  if (!visible) {
    throw new PublishError("This workspace's Zernio key was rejected — re-check it in Settings");
  }
  if (!visible.some((a) => a.id === cfg.linkedinAccountId && a.platform === 'linkedin')) {
    throw new PublishError(
      "The wired LinkedIn profile isn't visible to this workspace's Zernio key — re-pick it in Settings"
    );
  }

  // Post extras — mentions live inside the copy already (@[Name](urn)).
  const options = (video.postOptions ?? {}) as {
    repostUrl?: string;
    disableLinkPreview?: boolean;
    firstComment?: string;
  };

  // Resolve media from the item's assets. A repost carries no media of its
  // own (Zernio: reshareUrl is mutually exclusive with mediaItems).
  const thumbnailAssetId = video.thumbnailUrl?.match(
    /^\/api\/videos\/[A-Za-z0-9]+\/assets\/([A-Za-z0-9]+)\/download/
  )?.[1];
  const usable = options.repostUrl ? [] : video.assets.filter((a) => a.id !== thumbnailAssetId);
  const firstVideo = usable.find((a) => a.kind === 'VIDEO');
  const images = usable.filter((a) => a.kind === 'IMAGE').slice(0, 9);
  const firstPdf = usable.find((a) => a.kind === 'FILE' && /\.pdf$/i.test(a.displayName));

  const mediaItems: ZernioMediaItem[] = [];
  let mediaKind: PostPublishResult['mediaKind'] = 'text';
  if (firstVideo) {
    const key = mediaUrlToKey(firstVideo.sourceUrl);
    if (key) {
      const src = await createPresignedVideoGetUrl(key, firstVideo.displayName, 3600);
      const url = await zernioUploadFromUrl(
        src,
        firstVideo.displayName,
        'video/mp4',
        firstVideo.sizeBytes ? Number(firstVideo.sizeBytes) : undefined,
        apiKey
      );
      mediaItems.push({ type: 'video', url });
      mediaKind = 'video';
    }
  } else if (images.length > 0) {
    for (const img of images) {
      if (!img.sourceUrl.startsWith('files/')) continue;
      const src = await createPresignedFileGetUrl(img.sourceUrl, img.displayName, 3600);
      const url = await zernioUploadFromUrl(
        src,
        img.displayName,
        guessImageContentType(img.displayName),
        img.sizeBytes ? Number(img.sizeBytes) : undefined,
        apiKey
      );
      mediaItems.push({ type: 'image', url });
    }
    if (mediaItems.length > 0) mediaKind = 'images';
  } else if (firstPdf && firstPdf.sourceUrl.startsWith('files/')) {
    const src = await createPresignedFileGetUrl(firstPdf.sourceUrl, firstPdf.displayName, 3600);
    const url = await zernioUploadFromUrl(
      src,
      firstPdf.displayName,
      'application/pdf',
      firstPdf.sizeBytes ? Number(firstPdf.sizeBytes) : undefined,
      apiKey
    );
    mediaItems.push({ type: 'document' as ZernioMediaItem['type'], url });
    mediaKind = 'document';
  }

  const platformSpecificData: Record<string, unknown> = {};
  if (options.repostUrl) platformSpecificData.reshareUrl = options.repostUrl;
  if (options.disableLinkPreview) platformSpecificData.disableLinkPreview = true;
  if (options.firstComment) platformSpecificData.firstComment = options.firstComment.slice(0, 1250);

  const scheduledFor = opts.scheduledFor?.trim();
  const { postId } = await zernioCreatePost(
    {
      content: copy,
      mediaItems,
      platforms: [
        {
          platform: 'linkedin',
          accountId: cfg.linkedinAccountId,
          ...(Object.keys(platformSpecificData).length > 0 ? { platformSpecificData } : {}),
        },
      ],
      ...(opts.mode === 'live'
        ? { publishNow: true }
        : scheduledFor
          ? ({ scheduledFor } as Record<string, unknown>)
          : { isDraft: true }),
    },
    apiKey
  );

  const mode: PostPublishResult['mode'] =
    opts.mode === 'live' ? 'live' : scheduledFor ? 'scheduled' : 'draft';
  const by = opts.actorName ? ` — by ${opts.actorName}` : '';
  const noteBody =
    mode === 'live'
      ? `📝 Posted to LinkedIn via Zernio${postId ? ` (post ${postId})` : ''}${by}`
      : mode === 'scheduled'
        ? `📝 Scheduled on LinkedIn via Zernio for ${scheduledFor}${postId ? ` (post ${postId})` : ''}${by}. Confirm any @tags in the Zernio editor.`
        : `📝 Drafted in Zernio for LinkedIn${postId ? ` (post ${postId})` : ''}${by}. Confirm any @tags there, then schedule or post.`;
  await db.videoNote.create({ data: { videoId: video.id, body: noteBody } });

  await db.video.update({
    where: { id: video.id },
    data: {
      ...(postId ? { zernioPostId: postId } : {}),
      ...(mode === 'live' ? { status: 'PUBLISHED' } : {}),
    },
  });

  return {
    mode,
    postId,
    accountId: cfg.linkedinAccountId,
    mediaKind,
    mediaCount: mediaItems.length,
  };
}
