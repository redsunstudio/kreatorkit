import { NextRequest, NextResponse } from 'next/server';
import { VideoAssetProvider } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { createPresignedFileGetUrl } from '@/lib/r2';
import {
  extractAudioFileNameFromProxyUrl,
  extractImageFileNameFromProxyUrl,
  extractVideoFileNameFromProxyUrl,
} from '@/lib/video-assets';
import { buildVideoObjectKey } from '@/lib/video-upload-validation';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string; assetId: string }>;
}

function sanitizeFileName(value: string): string {
  // whitelist: filename-safe characters only, collapse the rest
  const sanitized = value
    .replace(/[^A-Za-z0-9._ ()-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.length > 0 ? sanitized : 'asset';
}

function withExtension(displayName: string, fileName: string, fallbackExt: string): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : fallbackExt;
  const base = sanitizeFileName(displayName);
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}

// GET /api/agent/videos/[videoId]/assets/[assetId]/download
//
// The automation twin of the session asset-download route. Without this, footage a
// client hands off is invisible to the agent rail: the session route rejects the
// agent key, so any multi-source edit (scan capture + camera) could not be built
// without a browser login.
//
// Redirects to a short-lived presigned storage URL — raw footage runs to multiple
// GB and must never be piped through the app (see the OOM incident).
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId, assetId } = await params;

    const asset = await db.videoAsset.findFirst({
      where: { id: assetId, videoId },
      select: { id: true, provider: true, displayName: true, sourceUrl: true },
    });
    if (!asset) return apiErrors.notFound('Asset');

    let key: string | null = null;
    let downloadName = sanitizeFileName(asset.displayName);

    if (asset.provider === VideoAssetProvider.R2_FILE) {
      if (!asset.sourceUrl?.startsWith('files/')) {
        return apiErrors.badRequest('Invalid file asset');
      }
      key = asset.sourceUrl;
      downloadName = withExtension(asset.displayName, asset.sourceUrl, '');
    } else if (asset.provider === VideoAssetProvider.R2_IMAGE) {
      const fileName = extractImageFileNameFromProxyUrl(asset.sourceUrl);
      if (!fileName) return apiErrors.badRequest('Invalid image asset URL');
      key = `images/${fileName}`;
      downloadName = withExtension(asset.displayName, fileName, '.png');
    } else if (asset.provider === VideoAssetProvider.R2_AUDIO) {
      const fileName = extractAudioFileNameFromProxyUrl(asset.sourceUrl);
      if (!fileName) return apiErrors.badRequest('Invalid audio asset URL');
      key = `voice/${fileName}`;
      downloadName = withExtension(asset.displayName, fileName, '.webm');
    } else if (asset.provider === VideoAssetProvider.R2_VIDEO) {
      const fileName = extractVideoFileNameFromProxyUrl(asset.sourceUrl);
      if (!fileName) return apiErrors.badRequest('Invalid video asset URL');
      key = buildVideoObjectKey(fileName);
      downloadName = withExtension(asset.displayName, fileName, '.mp4');
    } else {
      return apiErrors.badRequest(
        `${asset.provider} assets cannot be downloaded through the agent API`
      );
    }

    const presigned = await createPresignedFileGetUrl(key, downloadName);
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    logError('Error downloading asset (agent):', error);
    return apiErrors.internalError('Failed to download asset');
  }
}
