import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Settings, FolderOpen, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { ModuleNav } from '@/components/workspace/module-nav';
import { CoverButton } from '@/components/workspace/cover-button';
import { TaskDrawer } from '@/components/workspace/task-drawer';
import { ThumbnailImage } from '@/components/thumbnail-image';

interface WorkspaceTabsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}

/**
 * The workspace SHELL — breadcrumb, hero, admin buttons and the module tab
 * bar — rendered once for every tab under it. Tab switches only replace the
 * panel (`children`), so the shell never unmounts into a skeleton and the
 * switch feels like Frame.io rather than a page load. Each tab page keeps its
 * own data fetch and its own access check; this layout only owns the chrome.
 */
export default async function WorkspaceTabsLayout({ children, params }: WorkspaceTabsLayoutProps) {
  const session = await auth();
  const { workspaceId } = await params;
  if (!session?.user?.id) redirect('/login');

  const [{ access }, workspace, pipelineCount] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        ownerId: true,
        features: true,
        brandAccent: true,
        coverKey: true,
        members: { where: { userId: session.user.id }, select: { role: true } },
        _count: { select: { members: true } },
      },
    }),
    db.video.count({
      where: { project: { workspaceId }, status: { notIn: ['ARCHIVED', 'PUBLISHED'] } },
    }),
  ]);
  if (!workspace || !access) notFound();

  const isOwner = session.user.id === workspace.ownerId;
  const membership = workspace.members[0];
  const isAdmin = isOwner || membership?.role === 'ADMIN';
  if (!access.hasAccess || (!isOwner && !membership)) redirect('/dashboard');

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
                {pipelineCount} videos
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

      <ModuleNav workspace={workspace} />

      {children}
    </div>
  );
}
