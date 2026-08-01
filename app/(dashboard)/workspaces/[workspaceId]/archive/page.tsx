import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Film, MessageSquare } from 'lucide-react';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { ThumbnailImage } from '@/components/thumbnail-image';

interface ArchivePageProps {
  params: Promise<{ workspaceId: string }>;
}

// The workspace archive: finished videos removed from the pipeline but kept on
// record — thumbnail, brief, comments and the final cut survive housekeeping.
export default async function WorkspaceArchivePage({ params }: ArchivePageProps) {
  const session = await auth();
  const { workspaceId } = await params;
  if (!session?.user?.id) redirect('/login');

  const [{ workspace: accessWorkspace, access }, workspace, archived] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, ownerId: true, brandAccent: true },
    }),
    db.video.findMany({
      where: { project: { workspaceId }, status: 'ARCHIVED' },
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
          select: { versionNumber: true, _count: { select: { comments: true } } },
        },
      },
    }),
  ]);
  if (!workspace || !accessWorkspace || !access) notFound();
  if (!access.hasAccess) redirect('/dashboard');

  return (
    <div
      className="px-6 lg:px-8 py-8 w-full max-w-5xl mx-auto"
      style={
        workspace.brandAccent
          ? ({ '--primary': workspace.brandAccent } as React.CSSProperties)
          : undefined
      }
    >
      <div className="mb-6">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {workspace.name}
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">📦 Archive</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Finished videos, off the pipeline. Each keeps its thumbnail, brief, final cut and
          comments.
        </p>
      </div>

      {archived.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing archived yet — items land here when their status is set to Archived.
        </p>
      ) : (
        <div className="rounded-lg border divide-y bg-card overflow-hidden">
          {archived.map((v) => (
            <Link
              key={v.id}
              href={`/workspaces/${workspaceId}/videos/${v.id}`}
              className="flex items-center gap-4 px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
            >
              <ThumbnailImage
                src={
                  v.thumbnailUrl
                    ? v.thumbnailUrl.includes('?')
                      ? v.thumbnailUrl
                      : `${v.thumbnailUrl}?inline=1`
                    : null
                }
                className="h-9 w-16 rounded-md object-cover border border-white/10 flex-none"
                fallback={
                  <div className="h-9 w-16 rounded-md border border-white/10 bg-white/[0.04] flex items-center justify-center text-sm text-muted-foreground flex-none">
                    🎬
                  </div>
                }
              />
              <span className="text-sm font-medium truncate flex-1 min-w-0">{v.title}</span>
              {v.versions[0] && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono flex-none">
                  <Film className="h-3 w-3" />v{v.versions[0].versionNumber}
                </span>
              )}
              {(v.versions[0]?._count.comments ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono flex-none">
                  <MessageSquare className="h-3 w-3" />
                  {v.versions[0]?._count.comments}
                </span>
              )}
              <span className="text-xs text-muted-foreground font-mono flex-none">
                {v.updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
