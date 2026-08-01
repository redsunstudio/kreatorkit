import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink, Eye, MessageSquare, ThumbsUp } from 'lucide-react';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { isPublishDataStale, syncPublishedVideos } from '@/lib/publish-sync';
import { typeMeta } from '@/lib/video-type';
import { ModuleNav } from '@/components/workspace/module-nav';
import { ThumbnailImage } from '@/components/thumbnail-image';
import { PublishedStorageActions } from '@/app/(dashboard)/workspaces/[workspaceId]/published/published-storage-actions';

interface PublishedPageProps {
  params: Promise<{ workspaceId: string }>;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default async function PublishedPage({ params }: PublishedPageProps) {
  const session = await auth();
  const { workspaceId } = await params;
  if (!session?.user?.id) redirect('/login');

  const load = () =>
    db.video.findMany({
      where: { status: 'PUBLISHED', project: { workspaceId } },
      orderBy: { updatedAt: 'desc' },
      include: {
        // ALL versions (not just active) — storage held by a video is
        // everything sitting in R2 for it, not just the kept cut.
        versions: { select: { thumbnailUrl: true, isActive: true, sizeBytes: true } },
        assets: { select: { sizeBytes: true } },
      },
    });

  const [{ workspace: accessWorkspace, access }, workspace, initialVideos] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({ where: { id: workspaceId } }),
    load(),
  ]);
  if (!workspace || !accessWorkspace || !access) notFound();
  if (!access.hasAccess || !hasModule(workspace, 'published')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  let videos = initialVideos;

  // The ~24h sync, done lazily: refresh URL + analytics when anything is stale.
  if (videos.some((v) => isPublishDataStale(v))) {
    try {
      const r = await syncPublishedVideos(workspaceId);
      if (r.synced > 0) videos = await load();
    } catch {
      /* the tab still renders with whatever we have */
    }
  }

  return (
    <div
      className="px-6 lg:px-8 py-8 w-full"
      style={
        workspace.brandAccent
          ? ({ '--primary': workspace.brandAccent } as React.CSSProperties)
          : undefined
      }
    >
      <div className="mb-6">
        <Link
          href="/workspaces"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          All Workspaces
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
      </div>

      <ModuleNav workspace={workspace} active="published" />

      {videos.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nothing published yet — when a video ships, it moves off the pipeline and lands here.
        </div>
      ) : (
        <div className="rounded-xl border bg-card divide-y divide-border overflow-hidden">
          {videos.map((v) => {
            const activeVersion = v.versions.find((ver) => ver.isActive) ?? v.versions[0];
            const thumb = v.thumbnailUrl
              ? v.thumbnailUrl.includes('?')
                ? v.thumbnailUrl
                : `${v.thumbnailUrl}?inline=1`
              : (activeVersion?.thumbnailUrl ?? null);
            const stats = (v.publishStats ?? {}) as Record<string, number>;
            const t = typeMeta(v.videoType);
            const totalBytes =
              v.versions.reduce((sum, ver) => sum + ver.sizeBytes, BigInt(0)) +
              v.assets.reduce((sum, asset) => sum + asset.sizeBytes, BigInt(0));
            return (
              <div
                key={v.id}
                className="flex items-center gap-4 px-4 py-3 group transition-colors border-l-2 border-l-transparent hover:border-l-primary hover:bg-white/[0.02]"
              >
                <Link href={`/workspaces/${workspaceId}/videos/${v.id}`} className="shrink-0 block">
                  <ThumbnailImage
                    src={thumb}
                    className="w-24 aspect-video object-cover rounded-md"
                    fallback={
                      <div className="w-24 aspect-video bg-white/[0.04] rounded-md flex items-center justify-center text-lg">
                        🎬
                      </div>
                    }
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/workspaces/${workspaceId}/videos/${v.id}`}
                    className="text-sm font-medium leading-snug line-clamp-1 hover:text-primary transition-colors"
                  >
                    <span className="mr-1.5" title={t.label}>
                      {t.emoji}
                    </span>
                    {v.title}
                  </Link>
                  {v.publishedUrl && (
                    <a
                      href={v.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      Watch on YouTube
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground font-mono shrink-0">
                  {typeof stats.views === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {fmtCount(stats.views)}
                    </span>
                  )}
                  {typeof stats.likes === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" />
                      {fmtCount(stats.likes)}
                    </span>
                  )}
                  {typeof stats.comments === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {fmtCount(stats.comments)}
                    </span>
                  )}
                  {v.publishStatsAt && (
                    <span title="Stats last synced">
                      {v.publishStatsAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  )}
                </div>
                <PublishedStorageActions
                  projectId={v.projectId}
                  videoId={v.id}
                  totalBytes={totalBytes.toString()}
                  storageClearedAt={v.storageClearedAt ? v.storageClearedAt.toISOString() : null}
                  canManage={access.canEdit}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
