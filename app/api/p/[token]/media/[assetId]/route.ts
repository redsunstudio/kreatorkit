import { NextRequest } from 'next/server';
import { apiErrors } from '@/lib/api-response';
import { getPostReviewByToken, resolveReviewMedia, reviewAssetKey } from '@/lib/post-review';
import { proxyR2MediaObject } from '@/lib/r2-media-proxy';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ token: string; assetId: string }>;
}

// GET — token-authed media for the public review page (same-origin, so the
// app CSP applies cleanly; supports range for video playback).
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

    return proxyR2MediaObject({
      request,
      key,
      fallbackContentType: 'application/octet-stream',
      cacheControl: 'private, max-age=300',
      extraHeaders: { 'X-Content-Type-Options': 'nosniff' },
      internalErrorMessage: 'Failed to load media',
    });
  } catch (error) {
    logError('review media failed:', error);
    return apiErrors.internalError('Failed to load media');
  }
}
