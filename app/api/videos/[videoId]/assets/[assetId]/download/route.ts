import { NextRequest, NextResponse } from 'next/server';
import {
  createPresignedFileGetUrl,
  createPresignedInlineGetUrl,
  INLINE_REDIRECT_CACHE,
} from '@/lib/r2';
import { VideoAssetProvider } from '@prisma/client';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { resolveBunnyDownloadSource } from '@/lib/bunny-download';
import { db } from '@/lib/db';
import {
  extractImageFileNameFromProxyUrl,
  extractAudioFileNameFromProxyUrl,
  extractVideoFileNameFromProxyUrl,
  getVideoAssetAccessContext,
} from '@/lib/video-assets';
import { buildVideoObjectKey } from '@/lib/video-upload-validation';
import { logError } from '@/lib/logger';

type RouteParams = { params: Promise<{ videoId: string; assetId: string }> };
type BunnySourcePreference = 'auto' | 'original' | 'compressed';

const IMAGE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const BUNNY_ALLOWED_QUALITIES = new Set([2160, 1440, 1080, 720, 480, 360, 240]);

function sanitizeFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.length > 0 ? sanitized : 'asset';
}

function imageContentTypeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return IMAGE_CONTENT_TYPE_BY_EXTENSION[ext] || 'application/octet-stream';
}

// GET /api/videos/[videoId]/assets/[assetId]/download
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Thumbnails (?inline=1) and real downloads share this route but not the
    // budget: a pipeline board paints dozens of inline requests at once, while
    // the strict download limit exists to stop multi-GB footage abuse.
    const isInlineView = request.nextUrl.searchParams.get('inline') === '1';
    const limited = await rateLimit(request, isInlineView ? 'asset-inline' : 'asset-download');
    if (limited) return limited;

    const { videoId, assetId } = await params;
    const context = await getVideoAssetAccessContext(request, videoId, 'VIEW');
    if (!context) return apiErrors.notFound('Video');
    if (!context.hasViewAccess) return apiErrors.forbidden('Access denied');
    if (!context.canDownloadAssets) {
      return apiErrors.forbidden('Downloads are disabled for this project');
    }

    const asset = await db.videoAsset.findFirst({
      where: { id: assetId, videoId },
      select: {
        id: true,
        provider: true,
        displayName: true,
        sourceUrl: true,
        providerVideoId: true,
      },
    });
    if (!asset) return apiErrors.notFound('Asset');
    if (asset.provider === VideoAssetProvider.YOUTUBE) {
      return apiErrors.badRequest('YouTube assets cannot be downloaded');
    }

    // ?inline=1 only actually serves an inline image on R2_FILE assets. Anywhere
    // else it falls through to a real download presign, so it must not keep the
    // loose inline budget — otherwise appending the flag to a multi-GB cut buys
    // 300 downloads a minute instead of 10.
    if (isInlineView && asset.provider !== VideoAssetProvider.R2_FILE) {
      const strictLimited = await rateLimit(request, 'asset-download');
      if (strictLimited) return strictLimited;
    }

    if (asset.provider === VideoAssetProvider.R2_FILE) {
      const key = asset.sourceUrl;
      // comment-files/ = generic files attached to review comments; same raw-key
      // convention as files/ (footage-handoff uploads).
      if (!key || !(key.startsWith('files/') || key.startsWith('comment-files/'))) {
        return apiErrors.badRequest('Invalid file asset');
      }
      const ext = key.includes('.') ? key.slice(key.lastIndexOf('.')) : '';
      const downloadName = sanitizeFileName(asset.displayName).endsWith(ext)
        ? sanitizeFileName(asset.displayName)
        : `${sanitizeFileName(asset.displayName)}${ext}`;

      // Redirect to a short-lived presigned URL so bytes stream straight from
      // object storage instead of through the app server (piping OOM'd the
      // container). Inline viewers (thumbnail <img>) get an inline-disposition
      // presign via ?inline=1 — img-src CSP includes the storage origins.
      if (request.nextUrl.searchParams.get('inline') === '1') {
        const presigned = await createPresignedInlineGetUrl(key, imageContentTypeFromFileName(key));
        return NextResponse.redirect(presigned, {
          status: 302,
          headers: { 'Cache-Control': INLINE_REDIRECT_CACHE },
        });
      }

      const presigned = await createPresignedFileGetUrl(key, downloadName);
      return NextResponse.redirect(presigned, 302);
    }

    if (asset.provider === VideoAssetProvider.R2_IMAGE) {
      const fileName = extractImageFileNameFromProxyUrl(asset.sourceUrl);
      if (!fileName) return apiErrors.badRequest('Invalid image asset URL');
      const key = `images/${fileName}`;
      const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.png';
      const downloadName = `${sanitizeFileName(asset.displayName)}${extension}`;

      const presigned = await createPresignedFileGetUrl(key, downloadName);
      return NextResponse.redirect(presigned, 302);
    }

    if (asset.provider === VideoAssetProvider.R2_AUDIO) {
      const fileName = extractAudioFileNameFromProxyUrl(asset.sourceUrl);
      if (!fileName) return apiErrors.badRequest('Invalid audio asset URL');
      const key = `voice/${fileName}`;
      const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.webm';
      const downloadName = `${sanitizeFileName(asset.displayName)}${ext}`;

      const presigned = await createPresignedFileGetUrl(key, downloadName);
      return NextResponse.redirect(presigned, 302);
    }

    if (asset.provider === VideoAssetProvider.R2_VIDEO) {
      const fileName = extractVideoFileNameFromProxyUrl(asset.sourceUrl);
      if (!fileName) return apiErrors.badRequest('Invalid video asset URL');
      const key = buildVideoObjectKey(fileName);
      const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.mp4';
      const downloadName = `${sanitizeFileName(asset.displayName)}${ext}`;

      // Raw footage runs to multiple GB — never pipe it through the app.
      const presigned = await createPresignedFileGetUrl(key, downloadName);
      return NextResponse.redirect(presigned, 302);
    }

    const sourceParam = request.nextUrl.searchParams.get('source');
    const rawQuality = request.nextUrl.searchParams.get('quality');
    const isPrepareOnly = request.nextUrl.searchParams.get('prepare') === '1';
    const requestedQuality = Number(rawQuality);
    const sourcePreference: BunnySourcePreference =
      sourceParam === null
        ? 'auto'
        : sourceParam === 'original' || sourceParam === 'compressed'
          ? sourceParam
          : 'auto';

    if (sourceParam !== null && sourceParam !== 'original' && sourceParam !== 'compressed') {
      return apiErrors.badRequest('Invalid source. Allowed values: original, compressed');
    }
    if (
      rawQuality !== null &&
      (!Number.isFinite(requestedQuality) || !BUNNY_ALLOWED_QUALITIES.has(requestedQuality))
    ) {
      return apiErrors.badRequest(
        'Invalid quality. Allowed values: 2160, 1440, 1080, 720, 480, 360, 240'
      );
    }
    if (rawQuality !== null && sourcePreference === 'original') {
      return apiErrors.badRequest('Quality cannot be used when source=original');
    }

    if (!asset.providerVideoId) {
      return apiErrors.badRequest('Missing Bunny asset video id');
    }

    const source = await resolveBunnyDownloadSource(
      asset.providerVideoId,
      Number.isFinite(requestedQuality) ? requestedQuality : null,
      sourcePreference
    );
    if (!source) {
      if (sourcePreference === 'original') {
        return apiErrors.notFound('Original file');
      }
      return apiErrors.notFound('Download file');
    }

    if (isPrepareOnly) {
      const response = successResponse({
        quality: source.quality,
        sourceType: source.sourceType,
      });
      return withCacheControl(response, 'private, no-store');
    }

    // Redirect to the Bunny source instead of proxying the body through the
    // app (same treatment as /api/versions/[versionId]/download).
    return NextResponse.redirect(source.url, 302);
  } catch (error) {
    logError('Error downloading asset:', error);
    return apiErrors.internalError('Failed to download asset');
  }
}
