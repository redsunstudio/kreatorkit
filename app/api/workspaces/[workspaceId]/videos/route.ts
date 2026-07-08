import { NextRequest } from 'next/server';
import { VideoType } from '@prisma/client';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

// POST /api/workspaces/[workspaceId]/videos
// KreatorKit flattened hierarchy: create a planned (IDEA) item directly in the
// workspace. The backing project is an internal implementation detail — we use
// the workspace's oldest project, creating a default "Content" project if none.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { workspaceId } = await params;
    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerId: true },
    });
    if (!workspace) return apiErrors.notFound('Workspace');

    const access = await checkWorkspaceAccess(workspace, session.user.id);
    if (!access.canEdit) {
      return apiErrors.forbidden('Access denied');
    }

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const brief = typeof body?.brief === 'string' ? body.brief.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    const videoType = typeof body?.videoType === 'string' ? body.videoType : 'LONGFORM';
    if (!title) return apiErrors.badRequest('Title is required');
    if (title.length > 200) return apiErrors.badRequest('Title must be 200 characters or fewer');
    if (!(Object.values(VideoType) as string[]).includes(videoType)) {
      return apiErrors.badRequest(
        'videoType must be one of ' + Object.values(VideoType).join(', ')
      );
    }

    let project = await db.project.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!project) {
      project = await db.project.create({
        data: {
          name: 'Content',
          slug: `content-${workspaceId.slice(-8)}-${Date.now().toString(36)}`,
          description: null,
          workspaceId,
          ownerId: workspace.ownerId,
          visibility: 'PRIVATE',
        },
        select: { id: true },
      });
    }

    const last = await db.video.findFirst({
      where: { projectId: project.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const video = await db.video.create({
      data: {
        title,
        brief: brief || null,
        description: description || null,
        videoType: videoType as VideoType,
        status: 'IDEA',
        projectId: project.id,
        position: (last?.position ?? -1) + 1,
      },
      include: { versions: true, _count: { select: { versions: true } } },
    });

    const response = successResponse(video, 201);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error creating workspace video item:', error);
    return apiErrors.internalError('Failed to create the item');
  }
}
