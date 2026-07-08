import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Settings, FolderOpen, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { VideoDragDropUploader } from '@/components/video-drag-drop-uploader';
import { isDirectFileUploadEnabled, isS3VideoUploadsEnabled } from '@/lib/feature-flags';
import { ModuleNav } from '@/components/workspace/module-nav';
import { PipelineBoard } from '@/components/pipeline-board';
import { CoverButton } from '@/components/workspace/cover-button';

interface WorkspacePageProps {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function WorkspacePage({ params, searchParams }: WorkspacePageProps) {
  const session = await auth();
  const { workspaceId } = await params;
  const resolvedSearchParams = await searchParams;
  const MAX_PAGE = 1000;

  if (!session?.user?.id) {
    redirect('/login');
  }

  const pageParam = resolvedSearchParams?.page;
  const parsedPage = pageParam ? Number(pageParam) : 1;
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= MAX_PAGE ? parsedPage : 1;
  const pageSize = 20;
  const skip = (page - 1) * pageSize;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: { select: { id: true, name: true } },
      members: {
        where: { userId: session.user.id },
        select: { role: true },
      },
      projects: {
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          _count: { select: { videos: true, members: true } },
        },
      },
      _count: { select: { projects: true, members: true } },
    },
  });

  if (!workspace) {
    notFound();
  }

  const isOwner = session.user.id === workspace.ownerId;
  const membership = workspace.members[0];
  const isMember = !!membership;
  const isAdmin = isOwner || membership?.role === 'ADMIN';
  const access = await checkWorkspaceAccess(
    { id: workspace.id, ownerId: workspace.ownerId },
    session.user.id
  );

  if (!access.hasAccess || (!isOwner && !isMember)) {
    redirect('/dashboard');
  }

  // KreatorKit flattened view: every video item across the workspace's (hidden) projects
  const workspaceVideos = await db.video.findMany({
    where: { project: { workspaceId } },
    orderBy: { updatedAt: 'desc' },
    take: 300,
    include: {
      versions: {
        where: { isActive: true },
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: { id: true, thumbnailUrl: true, _count: { select: { comments: true } } },
      },
      _count: { select: { versions: true } },
    },
  });
  const activeVideos = workspaceVideos.filter((v) => v.status !== 'ARCHIVED');
  const archivedCount = workspaceVideos.length - activeVideos.length;
  const pipelineItems = activeVideos.map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    videoType: v.videoType,
    brief: v.brief,
    currentVersion: v._count.versions,
    commentCount: v.versions[0]?._count.comments ?? 0,
    projectId: v.projectId,
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
          {workspace.coverKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/workspaces/${workspaceId}/cover`}
              alt=""
              className="h-16 w-16 rounded-2xl object-cover border border-white/10 shadow-lg shadow-black/40 flex-none"
            />
          ) : (
            <div
              className="h-16 w-16 rounded-2xl border border-white/10 flex items-center justify-center text-2xl font-bold flex-none"
              style={{
                background: `radial-gradient(circle at 30% 20%, ${workspace.brandAccent || '#30363d'}33, #161b22 75%)`,
                color: workspace.brandAccent || '#7d8590',
              }}
            >
              {workspace.name.slice(0, 1).toUpperCase()}
            </div>
          )}
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

      <PipelineBoard workspaceId={workspaceId} videos={pipelineItems} canEdit={isAdmin} />

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
