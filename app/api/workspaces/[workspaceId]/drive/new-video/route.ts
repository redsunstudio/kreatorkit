import { NextRequest } from 'next/server';
import { VideoType } from '@prisma/client';
import { auth } from '@/lib/auth';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { DRIVE_NEW_VIDEO_MAX_FILES, createVideoFromDriveSelection } from '@/lib/drive-assign';
import { resolveDriveAccess } from '@/lib/workspace-drive-server';

type RouteParams = { params: Promise<{ workspaceId: string }> };

// POST /api/workspaces/[id]/drive/new-video  { title, videoType?, fileIds?, folderIds? }
// Turns a Drive multi-select (loose files and/or whole folders) straight into
// a new pipeline item at EDITING — no round trip through the pipeline tab to
// create the idea first.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const { workspaceId: id } = await params;
    const access = await resolveDriveAccess(id);
    if (!access) return apiErrors.forbidden('Access denied');

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) return apiErrors.badRequest('Title is required');
    if (title.length > 200) return apiErrors.badRequest('Title must be 200 characters or fewer');

    const videoType = typeof body?.videoType === 'string' ? body.videoType : undefined;
    if (videoType && !(Object.values(VideoType) as string[]).includes(videoType)) {
      return apiErrors.badRequest(
        'videoType must be one of ' + Object.values(VideoType).join(', ')
      );
    }

    const fileIds = Array.isArray(body?.fileIds)
      ? body.fileIds.filter((v: unknown): v is string => typeof v === 'string')
      : [];
    const folderIds = Array.isArray(body?.folderIds)
      ? body.folderIds.filter((v: unknown): v is string => typeof v === 'string')
      : [];
    if (fileIds.length === 0 && folderIds.length === 0) {
      return apiErrors.badRequest('Select at least one file or folder');
    }

    const session = await auth();
    const result = await createVideoFromDriveSelection(
      id,
      { title, videoType: videoType as VideoType | undefined, fileIds, folderIds },
      { userId: access.userId, name: session?.user?.name ?? null }
    );

    if (!result.ok) {
      if (result.reason === 'workspace_not_found') return apiErrors.notFound('Workspace');
      if (result.reason === 'no_files') {
        return apiErrors.badRequest('None of the selected files or folders could be found');
      }
      return apiErrors.badRequest(`Select ${DRIVE_NEW_VIDEO_MAX_FILES} files or fewer at once`);
    }

    const response = successResponse(
      { videoId: result.videoId, videoTitle: result.videoTitle, assetsMoved: result.assetsMoved },
      201
    );
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to create a video from a drive selection:', error);
    return apiErrors.internalError('Failed to create the video');
  }
}
