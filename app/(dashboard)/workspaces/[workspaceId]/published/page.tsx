import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink, Eye, MessageSquare, ThumbsUp } from 'lucide-react';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { isPublishDataStale, syncPublishedVideos } from '@/lib/publish-sync';
import { typeMeta } from '@/lib/video-type';
import { ModuleNav } from '@/components/workspace/module-nav';

export const dynamic = 'force-dynamic';

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

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) notFound();
  const access = await checkWorkspaceAccess(
    { id: workspace.id, ownerId: workspace.ownerId },
    session.user.id
  );
  if (!access.hasAccess || !hasModule(workspace, 'published')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  const load = () =>
    db.video.findMany({
      where: { status: 'PUBLISHED', project: { workspaceId } },
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
          select: { thumbnailUrl: true },
        },
      },
    });

  let videos = await load();

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
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((v) => {
            const thumb = v.thumbnailUrl
              ? v.thumbnailUrl.includes('?')
                ? v.thumbnailUrl
                : `${v.thumbnailUrl}?inline=1`
              : (v.versions[0]?.thumbnailUrl ?? null);
            const stats = (v.publishStats ?? {}) as Record<string, number>;
            const t = typeMeta(v.videoType);
            return (
              <div
                key={v.id}
                className="rounded-2xl border bg-card overflow-hidden group transition-colors hover:border-white/20"
              >
                <Link href={`/workspaces/${workspaceId}/videos/${v.id}`} className="block">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      className="w-full aspect-video object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-white/[0.04] flex items-center justify-center text-2xl">
                      🎬
                    </div>
                  )}
                </Link>
                <div className="p-4 space-y-2.5">
                  <Link
                    href={`/workspaces/${workspaceId}/videos/${v.id}`}
                    className="text-sm font-medium leading-snug line-clamp-2 hover:text-primary transition-colors block"
                  >
                    {v.title}
                  </Link>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span title={t.label}>{t.emoji}</span>
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
                      <span className="ml-auto" title="Stats last synced">
                        {v.publishStatsAt.toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    )}
                  </div>
                  {v.publishedUrl && (
                    <a
                      href={v.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      Watch on YouTube
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
