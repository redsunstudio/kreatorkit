import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { auth, computeProjectAccess, projectAccessInclude } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { validateShareLinkAccess } from '@/lib/share-links';
import { getShareSessionFromRequest } from '@/lib/share-session';
import { logError } from '@/lib/logger';
import {
  MARKERS_PER_VERSION_MAX,
  MARKER_LABEL_MAX,
  markerDTO,
  validateMarkerInput,
} from '@/lib/review-markers';
import { isVersionMarkerFull, listMarkers } from '@/lib/review-markers-db';

type RouteParams = { params: Promise<{ versionId: string }> };

/**
 * Markers are the TEAM's signposts to the client, so reading them follows view
 * access (share-link guests included — they are the audience) while planting one
 * needs a signed-in member. A client answers markers with comments, not markers.
 */
async function resolveAccess(request: NextRequest, versionId: string) {
  const session = await auth();
  const userId = session?.user?.id;

  const version = await db.videoVersion.findUnique({
    where: { id: versionId },
    include: {
      video: {
        include: { project: { include: projectAccessInclude(userId) } },
      },
    },
  });
  if (!version) return { version: null as null };

  const project = version.video.project;
  const access = computeProjectAccess(project, userId);
  const shareSession = getShareSessionFromRequest(request, version.video.id);
  const shareAccess = shareSession
    ? await validateShareLinkAccess({
        token: shareSession.token,
        projectId: project.id,
        videoId: version.video.id,
        requiredPermission: 'VIEW',
        passwordVerified: shareSession.passwordVerified,
      })
    : { hasAccess: false, requiresPassword: false };

  return {
    version,
    session,
    userId,
    canRead: access.hasAccess || shareAccess.hasAccess,
    canWrite: !!userId && access.hasAccess,
  };
}

// GET /api/versions/[versionId]/markers
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { versionId } = await params;
    const { version, canRead } = await resolveAccess(request, versionId);
    if (!version) return apiErrors.notFound('Version');
    if (!canRead) return apiErrors.forbidden('Access denied');

    const response = successResponse({ markers: await listMarkers(versionId) });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to list review markers:', error);
    return apiErrors.internalError('Failed to load review markers');
  }
}

// POST /api/versions/[versionId]/markers  { timestamp, label }
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { versionId } = await params;
    const { version, session, userId, canRead, canWrite } = await resolveAccess(request, versionId);
    if (!version) return apiErrors.notFound('Version');
    if (!canRead) return apiErrors.forbidden('Access denied');
    if (!canWrite) return apiErrors.forbidden('Only team members can add review markers');

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return apiErrors.badRequest('Invalid body');

    const parsed = validateMarkerInput(
      (body as Record<string, unknown>).timestamp,
      (body as Record<string, unknown>).label
    );
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

    const created = await db.videoMarker.create({
      data: {
        versionId,
        timestamp: parsed.timestamp,
        label: parsed.label,
        createdById: userId ?? null,
        createdByName: session?.user?.name ?? session?.user?.email ?? null,
      },
      select: {
        id: true,
        timestamp: true,
        label: true,
        createdByName: true,
        createdAt: true,
      },
    });

    const response = successResponse({ marker: markerDTO(created) }, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to create a review marker:', error);
    return apiErrors.internalError('Failed to add the review marker');
  }
}
