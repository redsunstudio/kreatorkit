import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { syncPublishedVideos } from '@/lib/publish-sync';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

// POST /api/agent/workspaces/[workspaceId]/sync-published { force?: boolean }
// Refresh YouTube URLs + analytics for the workspace's published videos
// (the daily-cron entry point; the Published tab also syncs lazily on view).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId } = await params;
    const body = await request.json().catch(() => null);
    const result = await syncPublishedVideos(workspaceId, { force: body?.force === true });
    return withCacheControl(successResponse(result), 'private, no-store');
  } catch (error) {
    logError('agent published sync failed:', error);
    return apiErrors.internalError('Sync failed');
  }
}
