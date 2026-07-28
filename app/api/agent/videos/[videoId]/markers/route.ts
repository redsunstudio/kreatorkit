import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { logError } from '@/lib/logger';
import {
  MARKERS_PER_VERSION_MAX,
  MARKER_LABEL_MAX,
  markerDTO,
  validateMarkerInput,
} from '@/lib/review-markers';
import { isVersionMarkerFull, listMarkers } from '@/lib/review-markers-db';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

/** Markers hang off a CUT, so resolve the item's active cut unless one is named. */
async function resolveVersionId(videoId: string, requested?: unknown): Promise<string | null> {
  if (typeof requested === 'string' && requested) {
    const explicit = await db.videoVersion.findFirst({
      where: { id: requested, videoParentId: videoId },
      select: { id: true },
    });
    return explicit?.id ?? null;
  }
  const active = await db.videoVersion.findFirst({
    where: { videoParentId: videoId },
    orderBy: [{ isActive: 'desc' }, { versionNumber: 'desc' }],
    select: { id: true },
  });
  return active?.id ?? null;
}

// GET /api/agent/videos/[videoId]/markers[?versionId=]
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
    if (!video) return apiErrors.notFound('Video');

    const versionId = await resolveVersionId(
      videoId,
      new URL(request.url).searchParams.get('versionId') ?? undefined
    );
    if (!versionId) return successResponse({ versionId: null, markers: [] });

    const response = successResponse({ versionId, markers: await listMarkers(versionId) });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Agent marker list failed:', error);
    return apiErrors.internalError('Failed to load review markers');
  }
}

// POST /api/agent/videos/[videoId]/markers  { timestamp, label, versionId? }
// The rail the editing skills use to signpost "client should eyeball this" moments
// while they cut, so the markers are already there when the review link goes out.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return apiErrors.badRequest('Invalid body');
    const input = body as Record<string, unknown>;

    const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
    if (!video) return apiErrors.notFound('Video');

    const versionId = await resolveVersionId(videoId, input.versionId);
    if (!versionId) {
      return apiErrors.badRequest('This item has no cut yet — upload one before adding markers');
    }

    const parsed = validateMarkerInput(input.timestamp, input.label);
    if (!parsed.ok) {
      if (parsed.reason === 'timestamp') {
        return apiErrors.badRequest('timestamp must be seconds or a clock string like 1:23');
      }
      if (parsed.reason === 'label_length') {
        return apiErrors.badRequest(`label must be ${MARKER_LABEL_MAX} characters or fewer`);
      }
      return apiErrors.badRequest('label is required');
    }

    if (await isVersionMarkerFull(versionId)) {
      return apiErrors.badRequest(`A cut can carry at most ${MARKERS_PER_VERSION_MAX} markers`);
    }

    const createdByName =
      typeof input.createdByName === 'string' && input.createdByName.trim()
        ? input.createdByName.trim().slice(0, 80)
        : 'Agent';

    const created = await db.videoMarker.create({
      data: {
        versionId,
        timestamp: parsed.timestamp,
        label: parsed.label,
        createdByName,
      },
      select: {
        id: true,
        timestamp: true,
        label: true,
        createdByName: true,
        createdAt: true,
      },
    });

    const response = successResponse({ versionId, marker: markerDTO(created) }, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Agent marker create failed:', error);
    return apiErrors.internalError('Failed to add the review marker');
  }
}

// DELETE /api/agent/videos/[videoId]/markers?markerId=…  (or ?all=1 to clear the cut)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const search = new URL(request.url).searchParams;
    const markerId = search.get('markerId');
    const clearAll = search.get('all') === '1';

    if (!markerId && !clearAll) {
      return apiErrors.badRequest('Pass markerId=… or all=1');
    }

    const versionId = await resolveVersionId(videoId, search.get('versionId') ?? undefined);
    if (!versionId) return apiErrors.notFound('Cut');

    if (clearAll) {
      const { count } = await db.videoMarker.deleteMany({ where: { versionId } });
      return withCacheControl(successResponse({ ok: true, deleted: count }), 'private, no-store');
    }

    // Scoped to this item's cut so an agent key can't delete across workspaces by id.
    const { count } = await db.videoMarker.deleteMany({
      where: { id: markerId!, versionId },
    });
    if (count === 0) return apiErrors.notFound('Marker');

    return withCacheControl(successResponse({ ok: true, deleted: count }), 'private, no-store');
  } catch (error) {
    logError('Agent marker delete failed:', error);
    return apiErrors.internalError('Failed to delete the review marker');
  }
}
