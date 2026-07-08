// Public post-review helpers: resolve a share token to a POST item and its
// reviewable media. Used by /p/[token] and its API — no session required,
// the token IS the access.

import { db } from '@/lib/db';
import { mediaUrlToKey } from '@/lib/r2-cleanup';

export async function getPostReviewByToken(token: string) {
  if (!token || token.length < 10) return null;
  const link = await db.shareLink.findUnique({
    where: { token },
    include: {
      video: {
        include: {
          assets: { orderBy: { createdAt: 'asc' } },
          project: {
            select: {
              workspace: { select: { id: true, name: true, ownerId: true, brandAccent: true } },
            },
          },
        },
      },
    },
  });
  if (!link?.video) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;
  return { link, video: link.video, workspace: link.video.project.workspace };
}

export interface ReviewMedia {
  assetId: string;
  kind: 'image' | 'video' | 'pdf';
  name: string;
}

/** Mirror the publish-time media resolution: video > images(≤9) > pdf. */
export function resolveReviewMedia(video: {
  thumbnailUrl: string | null;
  postOptions?: unknown;
  assets: { id: string; kind: string; displayName: string; sourceUrl: string }[];
}): ReviewMedia[] {
  const options = (video.postOptions ?? {}) as { repostUrl?: string };
  if (options.repostUrl) return [];
  const thumbId = video.thumbnailUrl?.match(
    /^\/api\/videos\/[A-Za-z0-9]+\/assets\/([A-Za-z0-9]+)\/download/
  )?.[1];
  const usable = video.assets.filter((a) => a.id !== thumbId);
  const firstVideo = usable.find((a) => a.kind === 'VIDEO');
  if (firstVideo) {
    return [{ assetId: firstVideo.id, kind: 'video', name: firstVideo.displayName }];
  }
  const images = usable.filter((a) => a.kind === 'IMAGE').slice(0, 9);
  if (images.length > 0) {
    return images.map((a) => ({ assetId: a.id, kind: 'image' as const, name: a.displayName }));
  }
  const pdf = usable.find((a) => a.kind === 'FILE' && /\.pdf$/i.test(a.displayName));
  return pdf ? [{ assetId: pdf.id, kind: 'pdf', name: pdf.displayName }] : [];
}

/** Storage key for a reviewable asset (used by the token-authed media proxy). */
export function reviewAssetKey(asset: { sourceUrl: string }): string | null {
  return mediaUrlToKey(asset.sourceUrl);
}
