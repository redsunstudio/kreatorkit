import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { logError } from '@/lib/logger';
import { assignDriveFileToVideo } from '@/lib/drive-assign';
import {
  DRIVE_LINK_DEFAULT_TTL_DAYS,
  DRIVE_LINK_LABEL_MAX,
  driveFileDTO,
  newUploadToken,
} from '@/lib/workspace-drive';

type RouteParams = { params: Promise<{ workspaceId: string }> };

function baseUrl(request: NextRequest): string {
  for (const configured of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    if (!configured?.trim()) continue;
    try {
      return new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
        .origin;
    } catch {
      // fall through
    }
  }
  return request.nextUrl.origin;
}

// GET /api/agent/workspaces/[id]/drive — unsorted files + live grab links.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId: id } = await params;

    const workspace = await db.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!workspace) return apiErrors.notFound('Workspace');

    const [files, links] = await Promise.all([
      db.workspaceUpload.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          displayName: true,
          contentType: true,
          sizeBytes: true,
          uploaderName: true,
          createdAt: true,
          link: { select: { label: true } },
        },
      }),
      db.workspaceUploadLink.findMany({
        where: { workspaceId: id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, token: true, label: true, expiresAt: true, createdAt: true },
      }),
    ]);

    const origin = baseUrl(request);
    const response = successResponse({
      files: files.map(driveFileDTO),
      links: links.map((l) => ({
        id: l.id,
        label: l.label,
        url: `${origin}/u/${l.token}`,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Agent drive list failed:', error);
    return apiErrors.internalError('Failed to load the drive');
  }
}

// POST /api/agent/workspaces/[id]/drive
//   { action: 'link', label?, expiresInDays? }        -> mint a content grab link
//   { action: 'assign', uploadId, videoId }           -> sort a file onto an item
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId: id } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return apiErrors.badRequest('Invalid body');
    const input = body as Record<string, unknown>;

    const workspace = await db.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!workspace) return apiErrors.notFound('Workspace');

    if (input.action === 'assign') {
      const uploadId = typeof input.uploadId === 'string' ? input.uploadId.trim() : '';
      const videoId = typeof input.videoId === 'string' ? input.videoId.trim() : '';
      if (!uploadId || !videoId) {
        return apiErrors.badRequest('uploadId and videoId are required');
      }
      const result = await assignDriveFileToVideo(id, uploadId, videoId, {
        userId: null,
        name: 'Agent',
      });
      if (!result.ok) {
        return result.reason === 'file_not_found'
          ? apiErrors.notFound('File')
          : apiErrors.notFound('Video');
      }
      return withCacheControl(
        successResponse({ ok: true, assetId: result.assetId, videoTitle: result.videoTitle }),
        'private, no-store'
      );
    }

    if (input.action === 'link') {
      const label =
        typeof input.label === 'string' && input.label.trim()
          ? input.label.trim().slice(0, DRIVE_LINK_LABEL_MAX)
          : null;

      let expiresAt: Date | null;
      if (input.expiresInDays === 0 || input.expiresInDays === null) {
        expiresAt = null;
      } else {
        const days = Number.isFinite(Number(input.expiresInDays))
          ? Math.min(Math.max(Math.trunc(Number(input.expiresInDays)), 1), 365)
          : DRIVE_LINK_DEFAULT_TTL_DAYS;
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      const created = await db.workspaceUploadLink.create({
        data: { workspaceId: id, token: newUploadToken(), label, expiresAt },
      });
      return withCacheControl(
        successResponse(
          {
            id: created.id,
            label: created.label,
            url: `${baseUrl(request)}/u/${created.token}`,
            expiresAt: created.expiresAt?.toISOString() ?? null,
          },
          201
        ),
        'private, no-store'
      );
    }

    return apiErrors.badRequest("action must be 'link' or 'assign'");
  } catch (error) {
    logError('Agent drive action failed:', error);
    return apiErrors.internalError('Drive action failed');
  }
}
