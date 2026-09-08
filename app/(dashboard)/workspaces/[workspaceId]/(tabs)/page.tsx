import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { VideoDragDropUploader } from '@/components/video-drag-drop-uploader';
import { isDirectFileUploadEnabled, isS3VideoUploadsEnabled } from '@/lib/feature-flags';
import { hasModule } from '@/lib/workspace-features';
import { PipelineBoard } from '@/components/pipeline-board';

interface WorkspacePageProps {
  params: Promise<{ workspaceId: string }>;
}

// The hero + tab bar live in ../(tabs)/layout.tsx — this page is the panel only.

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
          select: {
            id: true,
            thumbnailUrl: true,
            // Badge = review feedback on the CURRENT cut only (John, 2026-08-08):
            // 0 means this cut is still awaiting review. parentId: null counts
            // THREADS, not messages, matching the review page's own total.
            _count: { select: { comments: { where: { parentId: null } } } },
          },
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
    <>
      <VideoDragDropUploader
        workspaceId={workspaceId}
        canUpload={isAdmin && workspace._count.projects > 0 && isDirectFileUploadEnabled()}
        directUploadProvider={isS3VideoUploadsEnabled() ? 'r2' : 'bunny'}
      />

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
    </>
  );
}
