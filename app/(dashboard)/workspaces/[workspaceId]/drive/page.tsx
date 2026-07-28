import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { ModuleNav } from '@/components/workspace/module-nav';
import { WorkspaceMemberRole } from '@prisma/client';
import { DriveClient } from './drive-client';

export const dynamic = 'force-dynamic';

interface DrivePageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function DrivePage({ params }: DrivePageProps) {
  const session = await auth();
  const { workspaceId } = await params;
  if (!session?.user?.id) redirect('/login');

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!workspace) notFound();

  const access = await checkWorkspaceAccess(
    { id: workspace.id, ownerId: workspace.ownerId },
    session.user.id
  );
  if (!access.hasAccess || !hasModule(workspace, 'drive')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  const isAdmin =
    workspace.ownerId === session.user.id ||
    workspace.members[0]?.role === WorkspaceMemberRole.ADMIN;

  // Assign targets: anything still in production. Published/archived items are
  // finished — dropping raw footage on them is almost always a mis-click.
  const items = await db.video.findMany({
    where: {
      project: { workspaceId },
      status: { notIn: ['PUBLISHED', 'ARCHIVED', 'REJECTED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: { id: true, title: true, status: true },
  });

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
          href={`/workspaces/${workspaceId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {workspace.name}
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Drive</h1>
        <p className="text-muted-foreground mt-1">
          Where client uploads land before they belong to a video.
        </p>
      </div>

      <ModuleNav workspace={workspace} active="drive" />

      <DriveClient workspaceId={workspaceId} isAdmin={isAdmin} items={items} />
    </div>
  );
}
