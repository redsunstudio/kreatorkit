import { NextRequest } from 'next/server';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { workspaceZernioConfig } from '@/lib/publish-video';
import { zernioResolveLinkedInMention } from '@/lib/zernio';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

// POST { url, displayName } — resolve a LinkedIn profile/company into the
// clickable @[Name](urn) format, using this workspace's own Zernio key.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;
    const session = await auth();
    if (!session?.user?.id) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        project: {
          select: { workspace: { select: { id: true, ownerId: true, publishing: true } } },
        },
      },
    });
    if (!video) return apiErrors.notFound('Video');
    const workspace = video.project.workspace;
    const access = await checkWorkspaceAccess(workspace, session.user.id);
    if (!access.hasAccess) return apiErrors.forbidden('Access denied');

    const apiKey = workspaceZernioConfig(workspace.publishing).apiKey;
    if (!apiKey) return apiErrors.badRequest('This workspace has no Zernio API key yet');

    const body = await request.json().catch(() => null);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (!url || !displayName) return apiErrors.badRequest('url and displayName are required');

    const mentionFormat = await zernioResolveLinkedInMention(url, displayName, apiKey).catch(
      () => null
    );
    if (!mentionFormat) {
      return apiErrors.badRequest(
        'Could not resolve that profile — check the URL and the exact display name'
      );
    }
    return withCacheControl(successResponse({ mentionFormat }), 'private, no-store');
  } catch (error) {
    logError('mention resolve failed:', error);
    return apiErrors.internalError('Could not resolve the mention');
  }
}
