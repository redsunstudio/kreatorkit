import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { ModuleNav } from '@/components/workspace/module-nav';
import { StrategyEditor } from '@/components/workspace/strategy-editor';
import { parseStrategy } from '@/lib/strategy';

interface StrategyPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function StrategyPage({ params }: StrategyPageProps) {
  const session = await auth();
  const { workspaceId } = await params;

  if (!session?.user?.id) {
    redirect('/login');
  }

  const [{ workspace: accessWorkspace, access }, workspace, pillarGroups] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        features: true,
        brandAccent: true,
        strategy: true,
      },
    }),
    // Strategy feedback loop: videos produced per content pillar.
    db.video.groupBy({
      by: ['pillarId'],
      where: { project: { workspaceId }, pillarId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  if (!workspace || !accessWorkspace || !access) notFound();

  if (!access.hasAccess || !hasModule(workspace, 'strategy')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  const canEdit = access.isOwner || access.isMember;
  const strategy = parseStrategy(workspace.strategy);
  const pillarCounts: Record<string, number> = {};
  for (const g of pillarGroups) if (g.pillarId) pillarCounts[g.pillarId] = g._count._all;

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
        <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
        <p className="text-muted-foreground mt-1">
          The channel&rsquo;s strategy — pillars, recurring ideas and notes the whole team works
          from.
        </p>
      </div>

      <ModuleNav workspace={workspace} active="strategy" />

      <StrategyEditor
        workspaceId={workspaceId}
        initial={strategy}
        canEdit={canEdit}
        canCreatePipeline={access.canEdit}
        accent={workspace.brandAccent}
        pillarCounts={pillarCounts}
      />
    </div>
  );
}
