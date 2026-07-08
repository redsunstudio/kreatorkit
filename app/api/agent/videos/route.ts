import { NextRequest } from 'next/server';
import { VideoStatus, VideoType } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { logError } from '@/lib/logger';

// KreatorKit agent surface — automation (Claude Code / Agency OS) reads and
// feeds the production pipeline. Auth: X-Agent-Key header (AGENT_API_KEY env).

function shape(v: {
  id: string;
  title: string;
  status: string;
  videoType: string;
  brief: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  updatedAt: Date;
  projectId: string;
  project: { workspaceId: string; workspace: { name: string; slug: string } };
  _count: { versions: number };
}) {
  return {
    id: v.id,
    title: v.title,
    status: v.status,
    videoType: v.videoType,
    brief: v.brief,
    description: v.description,
    thumbnailUrl: v.thumbnailUrl,
    updatedAt: v.updatedAt.toISOString(),
    projectId: v.projectId,
    workspaceId: v.project.workspaceId,
    workspaceName: v.project.workspace.name,
    workspaceSlug: v.project.workspace.slug,
    versionCount: v._count.versions,
  };
}

// GET /api/agent/videos?status=APPROVED&workspaceId=...
export async function GET(request: NextRequest) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const sp = request.nextUrl.searchParams;
    const status = sp.get('status');
    const workspaceId = sp.get('workspaceId');
    if (status && !(Object.values(VideoStatus) as string[]).includes(status)) {
      return apiErrors.badRequest('unknown status');
    }
    const videos = await db.video.findMany({
      where: {
        ...(status ? { status: status as VideoStatus } : {}),
        ...(workspaceId ? { project: { workspaceId } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        project: {
          select: { workspaceId: true, workspace: { select: { name: true, slug: true } } },
        },
        _count: { select: { versions: true } },
      },
    });
    return withCacheControl(successResponse({ videos: videos.map(shape) }), 'private, no-store');
  } catch (error) {
    logError('agent videos list failed:', error);
    return apiErrors.internalError('Failed to list videos');
  }
}

// POST /api/agent/videos { workspaceId, title, brief? } -> planned IDEA item
export async function POST(request: NextRequest) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const body = await request.json().catch(() => null);
    const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const brief = typeof body?.brief === 'string' ? body.brief.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    const videoType = typeof body?.videoType === 'string' ? body.videoType : 'LONGFORM';
    if (!workspaceId || !title) return apiErrors.badRequest('workspaceId and title are required');
    if (!(Object.values(VideoType) as string[]).includes(videoType)) {
      return apiErrors.badRequest(
        'videoType must be one of ' + Object.values(VideoType).join(', ')
      );
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerId: true },
    });
    if (!workspace) return apiErrors.notFound('Workspace');

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
    });
    return withCacheControl(
      successResponse(
        { id: video.id, title: video.title, status: video.status, videoType: video.videoType },
        201
      ),
      'private, no-store'
    );
  } catch (error) {
    logError('agent video create failed:', error);
    return apiErrors.internalError('Failed to create the item');
  }
}
