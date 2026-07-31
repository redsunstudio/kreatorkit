import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { driveFolderDTO, sanitizeFolderName } from '@/lib/workspace-drive';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// GET /api/workspaces/[id]/drive/folders — every folder + its file count.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'asset-list');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const folders = await db.workspaceUploadFolder.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, createdAt: true, _count: { select: { uploads: true } } },
    });

    const response = successResponse({ folders: folders.map(driveFolderDTO) });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to list drive folders:', error);
    return apiErrors.internalError('Failed to load folders');
  }
}

// POST /api/workspaces/[id]/drive/folders  { name }
// Find-or-create by exact name — idempotent, so dropping the same directory
// twice (e.g. a folder upload retried after a partial failure) doesn't
// proliferate duplicate folders.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!rawName) return apiErrors.badRequest('name is required');
    const name = sanitizeFolderName(rawName);

    const existing = await db.workspaceUploadFolder.findFirst({
      where: { workspaceId: id, name },
      select: { id: true, name: true, createdAt: true, _count: { select: { uploads: true } } },
    });
    if (existing) {
      return withCacheControl(
        successResponse({ folder: driveFolderDTO(existing) }),
        'private, no-store'
      );
    }

    const created = await db.workspaceUploadFolder.create({
      data: { workspaceId: id, name, createdById: access.userId },
      select: { id: true, name: true, createdAt: true, _count: { select: { uploads: true } } },
    });

    const response = successResponse({ folder: driveFolderDTO(created) }, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to create a drive folder:', error);
    return apiErrors.internalError('Failed to create the folder');
  }
}
