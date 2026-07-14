'use client';

import Link from 'next/link';
import { Plus, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from 'next/navigation';

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface SerializedWorkspace {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  _count: {
    projects: number;
    members: number;
  };
  brandAccent?: string | null;
  coverUrl?: string | null;
  videoCount?: number;
}

interface WorkspacesClientProps {
  workspaces: SerializedWorkspace[];
  totalPages: number;
  currentPage: number;
  workspaceCreation: {
    canCreateWorkspace: boolean;
    reason: string | null;
  };
}

export function WorkspacesClient({
  workspaces,
  totalPages,
  currentPage,
  workspaceCreation,
}: WorkspacesClientProps) {
  const router = useRouter();

  return (
    <div className="px-6 lg:px-8 py-8 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground mt-1">Manage your workspaces and their projects</p>
          {!workspaceCreation.canCreateWorkspace && workspaceCreation.reason ? (
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">
              {workspaceCreation.reason}
            </p>
          ) : null}
        </div>
        {workspaceCreation.canCreateWorkspace ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/workspaces/new">
              <Plus className="h-4 w-4 mr-2" />
              New Workspace
            </Link>
          </Button>
        ) : (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/settings">Upgrade to Create Workspace</Link>
          </Button>
        )}
      </div>

      {/* Workspaces Grid */}
      {workspaces.length > 0 ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {workspaces.map((workspace) => (
            <Link key={workspace.id} href={`/workspaces/${workspace.id}`} className="group">
              <div
                className="relative aspect-[4/5] rounded-[1.4rem] border bg-card p-4 flex flex-col overflow-hidden transition-all duration-200 ease-out group-hover:-translate-y-1 group-hover:border-white/20"
                style={{
                  boxShadow: `0 0 0 rgba(0,0,0,0)`,
                }}
              >
                {/* ambient accent glow behind the artwork */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-48 w-48 rounded-full blur-3xl opacity-25 group-hover:opacity-40 transition-opacity duration-300"
                  style={{ background: workspace.brandAccent || '#7d8590' }}
                />
                {/* square cover art */}
                <div className="relative aspect-square w-full rounded-[1rem] overflow-hidden border border-white/10 shadow-lg shadow-black/40">
                  {workspace.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={workspace.coverUrl}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{
                        background: `radial-gradient(circle at 30% 20%, ${workspace.brandAccent || '#30363d'}33, #161b22 75%)`,
                      }}
                    >
                      <span
                        className="text-6xl font-bold opacity-80"
                        style={{ color: workspace.brandAccent || '#7d8590' }}
                      >
                        {workspace.name.slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                {/* meta */}
                <div className="relative mt-4 flex-1 flex flex-col">
                  <h3 className="font-semibold text-[15px] leading-snug line-clamp-1">
                    {workspace.name}
                  </h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                    {workspace.description || ''}
                  </p>
                  <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground font-mono pt-3">
                    <span>🎬 {workspace.videoCount ?? 0}</span>
                    <span>👥 {workspace._count.members + 1}</span>
                    <span className="ml-auto">
                      {formatRelativeTime(new Date(workspace.updatedAt))}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No workspaces yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create a workspace to organize your projects and invite team members
            </p>
            {workspaceCreation.canCreateWorkspace ? (
              <Button asChild>
                <Link href="/workspaces/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Workspace
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/settings">Upgrade to Create Workspace</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-end space-x-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => {
              if (currentPage > 1) {
                router.push(`/workspaces?page=${currentPage - 1}`);
                router.refresh();
              }
            }}
          >
            Previous
          </Button>
          <span className="text-sm font-medium">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => {
              if (currentPage < totalPages) {
                router.push(`/workspaces?page=${currentPage + 1}`);
                router.refresh();
              }
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
