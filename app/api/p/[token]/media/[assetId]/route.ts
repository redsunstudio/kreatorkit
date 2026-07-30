import { NextRequest, NextResponse } from 'next/server';
import { apiErrors } from '@/lib/api-response';
import { getPostReviewByToken, resolveReviewMedia, reviewAssetKey } from '@/lib/post-review';
import { createPresignedInlineGetUrl, INLINE_REDIRECT_CACHE } from '@/lib/r2';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ token: string; assetId: string }>;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  pdf: 'application/pdf',
};

function contentTypeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  return CONTENT_TYPE_BY_EXTENSION[ext] || 'application/octet-stream';
}

// GET — token-authed media for the public review page. Auth + presign only:
// the bytes stream browser<->storage via a 302 to a presigned inline URL
// (piping media through the app OOM'd the container). The page CSP allows
// the storage origins in img-src/media-src; the PDF link is a top-level
// navigation, which CSP does not gate.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token, assetId } = await params;
    const ctx = await getPostReviewByToken(token);
    if (!ctx || ctx.video.videoType !== 'POST') return apiErrors.notFound('Review');

    const allowed = resolveReviewMedia(ctx.video).some((m) => m.assetId === assetId);
    if (!allowed) return apiErrors.notFound('Media');
    const asset = ctx.video.assets.find((a) => a.id === assetId);
    const key = asset ? reviewAssetKey(asset) : null;
    if (!key) return apiErrors.notFound('Media');

    const presigned = await createPresignedInlineGetUrl(key, contentTypeFromKey(key));
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { 'Cache-Control': INLINE_REDIRECT_CACHE },
    });
  } catch (error) {
    logError('review media failed:', error);
    return apiErrors.internalError('Failed to load media');
  }
}
