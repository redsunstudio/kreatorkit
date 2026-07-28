import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import {
  DRIVE_LINK_DEFAULT_TTL_DAYS,
  DRIVE_LINK_LABEL_MAX,
  newUploadToken,
} from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Same precedence the share-link route uses: the operator-configured app URL
 * wins, because a grab link is pasted into an email and must survive whatever
 * host the request happened to arrive on.
 */
function resolveLinkBaseUrl(request: NextRequest): string {
  for (const configured of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    if (!configured?.trim()) continue;
    try {
      return new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
        .origin;
    } catch {
      // fall through to the request origin
    }
  }
  return request.nextUrl.origin;
}

function linkDTO(
  l: {
    id: string;
    token: string;
    label: string | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    _count?: { uploads: number };
  },
  baseUrl: string
) {
  return {
    id: l.id,
    label: l.label,
    url: `${baseUrl}/u/${l.token}`,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    revokedAt: l.revokedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    uploadCount: l._count?.uploads ?? 0,
  };
}

// GET /api/workspaces/[id]/drive/links
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');
    if (!access.isAdmin) return apiErrors.forbidden('Only workspace admins manage grab links');

    const links = await db.workspaceUploadLink.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { uploads: true } } },
    });

    const baseUrl = resolveLinkBaseUrl(request);
    return withCacheControl(
      successResponse({ links: links.map((l) => linkDTO(l, baseUrl)) }),
      'private, no-store'
    );
  } catch (error) {
    logError('Failed to list grab links:', error);
    return apiErrors.internalError('Failed to load grab links');
  }
}

// POST /api/workspaces/[id]/drive/links  { label?, expiresInDays? }
// Mints a content grab link. Expires by default — an upload door left open
// forever is the thing you regret, so opting out has to be deliberate (0 = never).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');
    if (!access.isAdmin) return apiErrors.forbidden('Only workspace admins mint grab links');

    const body = await request.json().catch(() => ({}));
    const label =
      typeof body?.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, DRIVE_LINK_LABEL_MAX)
        : null;

    let expiresAt: Date | null;
    if (body?.expiresInDays === 0 || body?.expiresInDays === null) {
      expiresAt = null;
    } else {
      const days = Number.isFinite(Number(body?.expiresInDays))
        ? Math.min(Math.max(Math.trunc(Number(body.expiresInDays)), 1), 365)
        : DRIVE_LINK_DEFAULT_TTL_DAYS;
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const created = await db.workspaceUploadLink.create({
      data: {
        workspaceId: id,
        token: newUploadToken(),
        label,
        expiresAt,
        createdById: access.userId,
      },
    });

    return withCacheControl(
      successResponse({ link: linkDTO(created, resolveLinkBaseUrl(request)) }, 201),
      'private, no-store'
    );
  } catch (error) {
    logError('Failed to mint a grab link:', error);
    return apiErrors.internalError('Failed to create the grab link');
  }
}
