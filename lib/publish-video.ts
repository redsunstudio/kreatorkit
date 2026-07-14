// Publish a KreatorKit video to YouTube through Zernio.
// The active cut is copied from our storage into Zernio's media store, then a
// post is created against the workspace's wired YouTube channel.
//
// Modes:
//   studio — publishNow with visibility PRIVATE: the video lands in the
//            client's YouTube Studio as a private draft they set live. This is
//            the "Push to YouTube" button. Gated on title+description+thumbnail.
//   draft  — parked in Zernio as a draft (automation staging).
//   live   — publishNow public; the item auto-flips to PUBLISHED.

import { db } from '@/lib/db';
import { createPresignedFileGetUrl, createPresignedVideoGetUrl } from '@/lib/r2';
import {
  zernioCreatePost,
  zernioGetPostStatus,
  zernioListAccounts,
  zernioUploadFromUrl,
} from '@/lib/zernio';
import type { ZernioMediaItem } from '@/lib/zernio';

export type PublishMode = 'studio' | 'draft' | 'live';

export class PublishError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
  }
}

export interface ZernioWorkspaceConfig {
  apiKey?: string;
  youtubeAccountId: string | null;
  linkedinAccountId: string | null;
}

/** Parse Workspace.publishing — { zernio: { apiKey?, youtubeAccountId?, linkedinAccountId? } }. */
export function workspaceZernioConfig(publishing: unknown): ZernioWorkspaceConfig {
  const empty = { youtubeAccountId: null, linkedinAccountId: null };
  if (!publishing || typeof publishing !== 'object') return empty;
  const zernio = (publishing as Record<string, unknown>).zernio;
  if (!zernio || typeof zernio !== 'object') return empty;
  const cfg = zernio as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    apiKey: str(cfg.apiKey) ?? undefined,
    youtubeAccountId: str(cfg.youtubeAccountId),
    linkedinAccountId: str(cfg.linkedinAccountId),
  };
}

export function workspaceYouTubeAccountId(publishing: unknown): string | null {
  return workspaceZernioConfig(publishing).youtubeAccountId;
}

/** Usable publish rail = the workspace's OWN key + a wired channel. No shared key. */
export function isWorkspacePublishReady(publishing: unknown): boolean {
  const cfg = workspaceZernioConfig(publishing);
  return Boolean(cfg.youtubeAccountId && cfg.apiKey);
}

/** LinkedIn rail (BETA posts): the workspace's own key + a wired LinkedIn profile. */
export function isWorkspaceLinkedInReady(publishing: unknown): boolean {
  const cfg = workspaceZernioConfig(publishing);
  return Boolean(cfg.linkedinAccountId && cfg.apiKey);
}

export interface PublishChecks {
  title: boolean;
  description: boolean;
  thumbnail: boolean;
  cut: boolean;
}

export function publishChecks(video: {
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  versions: { providerId: string; videoId: string }[];
}): PublishChecks {
  return {
    title: Boolean(video.title?.trim()),
    description: Boolean(video.description?.trim()),
    thumbnail: Boolean(video.thumbnailUrl),
    cut: video.versions.some((v) => v.providerId === 'r2' && v.videoId),
  };
}

function guessImageContentType(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

export interface PublishResult {
  mode: PublishMode;
  postId: string | null;
  accountId: string;
  thumbnailAttached: boolean;
}

export async function publishVideoToYouTube(
  videoId: string,
  opts: { mode?: PublishMode; actorName?: string; force?: boolean } = {}
): Promise<PublishResult> {
  const mode: PublishMode = opts.mode ?? 'draft';

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

  const cfg = workspaceZernioConfig(video.project.workspace.publishing);
  const apiKey = cfg.apiKey;
  if (!apiKey) {
    throw new PublishError(
      'This workspace has no Zernio API key — add its own key in Settings → YouTube publishing',
      503
    );
  }
  if (!cfg.youtubeAccountId) {
    throw new PublishError(
      'No YouTube channel is wired to this workspace yet — set it in Settings → YouTube publishing'
    );
  }

  // Double-push guard: this item already went to Zernio once. Drafts are
  // harmless; anything that reaches the channel again needs an explicit force.
  if (video.zernioPostId && mode !== 'draft' && !opts.force) {
    throw new PublishError(
      `This video already went to Zernio (post ${video.zernioPostId}) — it may be live or in the client's Studio. Pass force:true only if you really want a second push.`
    );
  }

  const checks = publishChecks(video);
  if (!checks.cut)
    throw new PublishError('No uploaded cut to publish — upload the final cut first');
  if (mode !== 'draft') {
    const missing = [
      !checks.title && 'a title',
      !checks.description && 'a description',
      !checks.thumbnail && 'a thumbnail',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new PublishError(`Not ready to push — add ${missing.join(', ')} first`);
    }
  }

  // Isolation guard: the wired channel must be visible to THIS workspace's own
  // key. A stale or mis-wired accountId can never post to another client's page.
  const visible = await zernioListAccounts(apiKey).catch(() => null);
  if (!visible) {
    throw new PublishError(
      "This workspace's Zernio key was rejected — re-check it in Settings → YouTube publishing"
    );
  }
  const channel = visible.find((a) => a.id === cfg.youtubeAccountId && a.platform === 'youtube');
  if (!channel) {
    throw new PublishError(
      "The wired YouTube channel isn't visible to this workspace's Zernio key — re-pick the channel in Settings → YouTube publishing"
    );
  }

  const cut = video.versions[0];
  const safeName = video.title.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'video';
  const sourceUrl = await createPresignedVideoGetUrl(cut.videoId, `${safeName}.mp4`, 6 * 3600);

  // ZERO-COPY for immediate publishes: Zernio's worker pulls the cut straight
  // from our storage via the presigned URL — the push returns in seconds
  // regardless of file size, nothing relays through the app. Drafts are the
  // exception: they can sit in Zernio longer than the URL lives, so their
  // bytes are copied into Zernio's store up front.
  const mediaUrl =
    mode === 'draft'
      ? await zernioUploadFromUrl(
          sourceUrl,
          `${safeName}.mp4`,
          'video/mp4',
          cut.sizeBytes ? Number(cut.sizeBytes) : undefined,
          apiKey
        )
      : sourceUrl;

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
          asset.sizeBytes ? Number(asset.sizeBytes) : undefined,
          apiKey
        );
      }
    } catch {
      thumbnailUrl = undefined; // the post still goes out without it
    }
  }

  const mediaItems: ZernioMediaItem[] = [
    { type: 'video', url: mediaUrl, ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}) },
  ];
  const { postId } = await zernioCreatePost(
    {
      content: video.description?.trim() || video.brief?.trim() || video.title,
      mediaItems,
      platforms: [
        {
          platform: 'youtube',
          accountId: cfg.youtubeAccountId,
          platformSpecificData: {
            title: video.title,
            visibility: mode === 'studio' ? 'private' : 'public',
            madeForKids: false,
          },
        },
      ],
      ...(mode === 'draft' ? { isDraft: true } : { publishNow: true }),
    },
    apiKey
  );

  // Catch instant validation/ingest failures (bad media URL etc). Zernio keeps
  // processing after we return — this only surfaces immediate hard failures.
  let zernioStatus: string | null = null;
  if (mode !== 'draft' && postId) {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const s = await zernioGetPostStatus(postId, apiKey);
        zernioStatus = s.platformStatus ?? s.status;
        if (zernioStatus === 'failed' || zernioStatus === 'error') {
          throw new PublishError(
            `Zernio could not process the push${s.platformError ? ` — ${s.platformError}` : ''}`,
            502
          );
        }
        if (zernioStatus === 'published' || zernioStatus === 'posted') break;
      } catch (e) {
        if (e instanceof PublishError) throw e;
        break; // status endpoint hiccup — the push itself was accepted
      }
    }
  }

  const by = opts.actorName ? ` — by ${opts.actorName}` : '';
  const noteBody =
    mode === 'studio'
      ? `📺 Pushed to YouTube${postId ? ` (Zernio post ${postId})` : ''}${by}. YouTube is ingesting it now — it appears in YouTube Studio as a PRIVATE video within a few minutes; set it live from Studio when ready.`
      : mode === 'live'
        ? `🚀 Published to YouTube via Zernio${postId ? ` (post ${postId})` : ''}${by}`
        : `📤 Sent to Zernio as a YouTube draft${postId ? ` (post ${postId})` : ''}${by}. Confirm the thumbnail in Zernio before publishing.`;
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
    accountId: cfg.youtubeAccountId,
    thumbnailAttached: Boolean(thumbnailUrl),
  };
}
