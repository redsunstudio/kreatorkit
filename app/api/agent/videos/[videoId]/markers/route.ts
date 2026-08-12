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
import { countMarkers, listMarkers } from '@/lib/review-markers-db';

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

// POST /api/agent/videos/[videoId]/markers
//   single: { timestamp, label, versionId?, createdByName? }
//   batch:  { markers: [{ timestamp, label }, …], versionId?, createdByName? }
// The rail the editing skills use to signpost "client should eyeball this" moments
// while they cut, so the markers are already there when the review link goes out.
// A pass over a cut produces a whole list at once, so the batch form exists to keep
// that one call instead of one round trip per timecode.
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

    const isBatch = Array.isArray(input.markers);
    const rawMarkers = isBatch ? (input.markers as unknown[]) : [input];
    if (rawMarkers.length === 0) return apiErrors.badRequest('markers is empty');

    const parsedMarkers: { timestamp: number; label: string }[] = [];
    for (const [index, raw] of rawMarkers.entries()) {
      if (!raw || typeof raw !== 'object') {
        return apiErrors.badRequest(`markers[${index}] must be an object`);
      }
      const entry = raw as Record<string, unknown>;
      const parsed = validateMarkerInput(entry.timestamp, entry.label);
      if (!parsed.ok) {
        const where = isBatch ? `markers[${index}]: ` : '';
        if (parsed.reason === 'timestamp') {
          return apiErrors.badRequest(
            `${where}timestamp must be seconds or a clock string like 1:23`
          );
        }
        if (parsed.reason === 'label_length') {
          return apiErrors.badRequest(
            `${where}label must be ${MARKER_LABEL_MAX} characters or fewer`
          );
        }
        return apiErrors.badRequest(`${where}label is required`);
      }
      parsedMarkers.push({ timestamp: parsed.timestamp, label: parsed.label });
    }

    // Checked against the whole batch, not one at a time, so a big list either
    // lands complete or is refused with the room that is actually left.
    const existing = await countMarkers(versionId);
    if (existing + parsedMarkers.length > MARKERS_PER_VERSION_MAX) {
      const room = Math.max(0, MARKERS_PER_VERSION_MAX - existing);
      return apiErrors.badRequest(
        `A cut can carry at most ${MARKERS_PER_VERSION_MAX} markers — room for ${room} more, got ${parsedMarkers.length}`
      );
    }

    const createdByName =
      typeof input.createdByName === 'string' && input.createdByName.trim()
        ? input.createdByName.trim().slice(0, 80)
        : 'Agent';

    const created = await db.videoMarker.createManyAndReturn({
      data: parsedMarkers.map((m) => ({
        versionId,
        timestamp: m.timestamp,
        label: m.label,
        createdByName,
      })),
      select: {
        id: true,
        timestamp: true,
        label: true,
        createdByName: true,
        createdAt: true,
      },
    });

    const markers = created.map(markerDTO).sort((a, b) => a.timestamp - b.timestamp);
    const response = successResponse(
      isBatch ? { versionId, markers, created: markers.length } : { versionId, marker: markers[0] },
      201
    );
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
