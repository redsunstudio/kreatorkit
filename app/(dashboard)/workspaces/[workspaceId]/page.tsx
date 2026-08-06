import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Settings, FolderOpen, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { VideoDragDropUploader } from '@/components/video-drag-drop-uploader';
import { isDirectFileUploadEnabled, isS3VideoUploadsEnabled } from '@/lib/feature-flags';
import { ModuleNav } from '@/components/workspace/module-nav';
import { hasModule } from '@/lib/workspace-features';
import { PipelineBoard } from '@/components/pipeline-board';
import { CoverButton } from '@/components/workspace/cover-button';
import { TaskDrawer } from '@/components/workspace/task-drawer';
import { ThumbnailImage } from '@/components/thumbnail-image';

interface WorkspacePageProps {
  params: Promise<{ workspaceId: string }>;
}

/** One line of brief is all the pipeline row shows — it truncates at ~240px. */
const BRIEF_PREVIEW_CHARS = 160;

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const session = await auth();
  const { workspaceId } = await params;

  if (!session?.user?.id) {
    redirect('/login');
  }

  // The workspace, its pipeline items and the archive tally are independent
  // reads keyed off the same id, so they go out together instead of in a chain.
  // Published and archived items are excluded in SQL rather than fetched and
  // then dropped in JS, and only the fields the board actually renders are
  // selected — this page used to pull 300 full video rows (whole brief bodies
  // included) plus a page of projects that nothing on screen uses.
  const PIPELINE_STATUS_FILTER = {
    project: { workspaceId },
    status: { notIn: ['ARCHIVED' as const, 'PUBLISHED' as const] },
  };

  const [{ access }, workspace, activeVideos, archivedCount, latestCutRows] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        owner: { select: { id: true, name: true } },
        members: {
          where: { userId: session.user.id },
          select: { role: true },
        },
        _count: { select: { projects: true, members: true } },
      },
    }),
    db.video.findMany({
      where: PIPELINE_STATUS_FILTER,
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        id: true,
        title: true,
        status: true,
        videoType: true,
        brief: true,
        projectId: true,
        thumbnailUrl: true,
        packagingConfirmedAt: true,
        membersOnly: true,
        versions: {
          where: { isActive: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, thumbnailUrl: true, _count: { select: { comments: true } } },
        },
        _count: { select: { versions: true } },
      },
    }),
    db.video.count({ where: { project: { workspaceId }, status: 'ARCHIVED' } }),
    // Newest cut per item — the ACTIVE version is not always the latest upload,
    // so this stays a separate aggregate. Filtering by the same relation as the
    // item query (rather than by a list of ids it returns) is what lets it ride
    // along in this batch instead of waiting for a second round trip.
    // NB: on VideoVersion the parent relation is videoParentId — `videoId` is
    // the PROVIDER's id (YouTube id / storage key) and groups to garbage keys
    // that never match Video.id.
    db.videoVersion.groupBy({
      by: ['videoParentId'],
      where: { video: PIPELINE_STATUS_FILTER },
      _max: { createdAt: true },
    }),
  ]);

  if (!workspace || !access) {
    notFound();
  }

  const isOwner = session.user.id === workspace.ownerId;
  const membership = workspace.members[0];
  const isMember = !!membership;
  const isAdmin = isOwner || membership?.role === 'ADMIN';

  if (!access.hasAccess || (!isOwner && !isMember)) {
    redirect('/dashboard');
  }

  const latestCutAtByVideo = new Map(
    latestCutRows.map((r) => [r.videoParentId, r._max.createdAt?.toISOString() ?? null])
  );

  const pipelineItems = activeVideos.map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    videoType: v.videoType,
    // Preview only — shipping whole brief bodies for every item made the
    // payload balloon for text nobody can read at this size.
    brief: v.brief ? v.brief.slice(0, BRIEF_PREVIEW_CHARS) : null,
    currentVersion: v._count.versions,
    commentCount: v.versions[0]?._count.comments ?? 0,
    projectId: v.projectId,
    latestCutAt: latestCutAtByVideo.get(v.id) ?? null,
    packagingDone: !!v.packagingConfirmedAt,
    membersOnly: v.membersOnly,
    thumbnailUrl: v.thumbnailUrl
      ? v.thumbnailUrl.includes('?')
        ? v.thumbnailUrl
        : `${v.thumbnailUrl}?inline=1`
      : (v.versions[0]?.thumbnailUrl ?? null),
  }));

  return (
    <div
      className="px-6 lg:px-8 py-8 w-full"
      style={
        workspace.brandAccent
          ? ({ '--primary': workspace.brandAccent } as React.CSSProperties)
          : undefined
      }
    >
      <VideoDragDropUploader
        workspaceId={workspaceId}
        canUpload={isAdmin && workspace._count.projects > 0 && isDirectFileUploadEnabled()}
        directUploadProvider={isS3VideoUploadsEnabled() ? 'r2' : 'bunny'}
      />
      {/* Back & Header */}
      <div className="mb-6">
        <Link
          href="/workspaces"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          All Workspaces
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <ThumbnailImage
            src={workspace.coverKey ? `/api/workspaces/${workspaceId}/cover` : null}
            className="h-16 w-16 rounded-2xl object-cover border border-white/10 shadow-lg shadow-black/40 flex-none"
            fallback={
              <div
                className="h-16 w-16 rounded-2xl border border-white/10 flex items-center justify-center text-2xl font-bold flex-none"
                style={{
                  background: `radial-gradient(circle at 30% 20%, ${workspace.brandAccent || '#30363d'}33, #161b22 75%)`,
                  color: workspace.brandAccent || '#7d8590',
                }}
              >
                {workspace.name.slice(0, 1).toUpperCase()}
              </div>
            }
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
            {workspace.description && (
              <p className="text-muted-foreground mt-1">{workspace.description}</p>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FolderOpen className="h-3.5 w-3.5" />
                {pipelineItems.length} videos
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {workspace._count.members + 1} members
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
          {isAdmin && (
            <>
              <CoverButton workspaceId={workspaceId} />
              <TaskDrawer workspaceId={workspaceId} accent={workspace.brandAccent} />
              <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                <Link href={`/workspaces/${workspaceId}/members`}>
                  <Users className="h-4 w-4 mr-2" />
                  Members
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                <Link href={`/workspaces/${workspaceId}/settings`}>
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <ModuleNav workspace={workspace} active="review" />

      <PipelineBoard
        workspaceId={workspaceId}
        videos={pipelineItems}
        canEdit={isAdmin}
        allowPosts={hasModule(workspace, 'posts')}
      />

      <div className="mt-2">
        <Link
          href={`/workspaces/${workspaceId}/archive`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          📦 Archive ({archivedCount})
        </Link>
      </div>
    </div>
  );
}
