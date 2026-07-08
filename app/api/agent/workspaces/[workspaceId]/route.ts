import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

// GET /api/agent/workspaces/[workspaceId] — config detail for automation.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId } = await params;
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        features: true,
        brandAccent: true,
        publishing: true,
      },
    });
    if (!workspace) return apiErrors.notFound('Workspace');
    return withCacheControl(successResponse(workspace), 'private, no-store');
  } catch (error) {
    logError('agent workspace detail failed:', error);
    return apiErrors.internalError('Failed to load the workspace');
  }
}

// PATCH /api/agent/workspaces/[workspaceId] { publishing?, features?, brandAccent? }
// e.g. { "publishing": { "zernio": { "youtubeAccountId": "..." } } }
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return apiErrors.badRequest('nothing to update');

    const data: Record<string, unknown> = {};
    if ('publishing' in body) {
      if (body.publishing !== null && typeof body.publishing !== 'object') {
        return apiErrors.badRequest('publishing must be an object or null');
      }
      data.publishing = body.publishing === null ? Prisma.DbNull : body.publishing;
    }
    if ('features' in body) {
      if (body.features !== null && typeof body.features !== 'object') {
        return apiErrors.badRequest('features must be an object or null');
      }
      data.features = body.features === null ? Prisma.DbNull : body.features;
    }
    if ('brandAccent' in body) {
      if (body.brandAccent !== null && typeof body.brandAccent !== 'string') {
        return apiErrors.badRequest('brandAccent must be a string or null');
      }
      data.brandAccent = body.brandAccent;
    }
    if (Object.keys(data).length === 0) return apiErrors.badRequest('nothing to update');

    const workspace = await db.workspace.update({
      where: { id: workspaceId },
      data,
      select: { id: true, name: true, features: true, brandAccent: true, publishing: true },
    });
    return withCacheControl(successResponse(workspace), 'private, no-store');
  } catch (error) {
    logError('agent workspace patch failed:', error);
    return apiErrors.internalError('Failed to update the workspace');
  }
}
