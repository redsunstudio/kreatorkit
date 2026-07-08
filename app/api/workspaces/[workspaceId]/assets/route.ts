import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { createPresignedFilePutUrl, getR2FileObjectMetadata } from '@/lib/r2';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

const MAX_ASSET_BYTES = BigInt(2 * 1024 * 1024 * 1024); // brand files: 2GB/file

function sanitizeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.\.+/g, '.');
  return base.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 160) || 'file';
}

async function workspaceAccess(workspaceId: string, userId: string) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerId: true },
  });
  if (!workspace) return null;
  return { workspace, access: await checkWorkspaceAccess(workspace, userId) };
}

// GET /api/workspaces/[workspaceId]/assets — the brand library
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();
    const { workspaceId } = await params;
    const ctx = await workspaceAccess(workspaceId, session.user.id);
    if (!ctx) return apiErrors.notFound('Workspace');
    if (!ctx.access.hasAccess) return apiErrors.forbidden('Access denied');

    const assets = await db.workspaceAsset.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    });
    return withCacheControl(
      successResponse({
        assets: assets.map((a) => ({
          id: a.id,
          displayName: a.displayName,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes.toString(),
          uploadedBy: a.uploadedBy?.name ?? null,
          createdAt: a.createdAt.toISOString(),
          isImage: (a.contentType || '').startsWith('image/'),
        })),
        canManage: ctx.access.canEdit,
      }),
      'private, no-store'
    );
  } catch (error) {
    logError('workspace assets list failed:', error);
    return apiErrors.internalError('Failed to load assets');
  }
}

// POST /api/workspaces/[workspaceId]/assets
//   { init: {fileName, contentType, sizeBytes} } -> presigned PUT
//   { commit: {objectKey, displayName} } -> creates the library record
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();
    const { workspaceId } = await params;
    const ctx = await workspaceAccess(workspaceId, session.user.id);
    if (!ctx) return apiErrors.notFound('Workspace');
    if (!ctx.access.hasAccess) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);

    if (body?.init) {
      const fileName = sanitizeName(String(body.init.fileName || ''));
      const contentType =
        typeof body.init.contentType === 'string' && body.init.contentType.trim()
          ? body.init.contentType.trim()
          : 'application/octet-stream';
      let sizeBytes: bigint;
      try {
        sizeBytes = BigInt(body.init.sizeBytes);
        if (sizeBytes <= BigInt(0) || sizeBytes > MAX_ASSET_BYTES) throw new Error();
      } catch {
        return apiErrors.badRequest('Brand assets are capped at 2GB per file');
      }
      const objectKey = `files/${randomUUID()}-brand-${fileName}`;
      const presignedPutUrl = await createPresignedFilePutUrl(objectKey, contentType, sizeBytes);
      return withCacheControl(
        successResponse({ presignedPutUrl, objectKey, contentType, displayName: fileName }),
        'private, no-store'
      );
    }

    if (body?.commit) {
      const objectKey = typeof body.commit.objectKey === 'string' ? body.commit.objectKey : '';
      if (!/^files\/[A-Za-z0-9-]{36}-brand-[A-Za-z0-9._ ()-]{1,170}$/.test(objectKey)) {
        return apiErrors.badRequest('objectKey must reference an uploaded brand asset');
      }
      const head = await getR2FileObjectMetadata(objectKey);
      if (!head || head.contentLength <= BigInt(0)) {
        return apiErrors.badRequest('Upload not found — upload the file first');
      }
      const displayName = sanitizeName(
        String(body.commit.displayName || objectKey.split('-brand-').pop() || 'file')
      );
      const asset = await db.workspaceAsset.create({
        data: {
          workspaceId,
          displayName,
          objectKey,
          contentType: head.contentType ?? null,
          sizeBytes: head.contentLength,
          uploadedById: session.user.id,
        },
      });
      return withCacheControl(
        successResponse({ id: asset.id, displayName: asset.displayName }, 201),
        'private, no-store'
      );
    }

    return apiErrors.badRequest('Provide init or commit');
  } catch (error) {
    logError('workspace asset upload failed:', error);
    return apiErrors.internalError('Failed to store the asset');
  }
}
