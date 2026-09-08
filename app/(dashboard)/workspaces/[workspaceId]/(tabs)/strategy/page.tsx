import { notFound, redirect } from 'next/navigation';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
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
    <>
      <p className="mb-6 text-sm text-muted-foreground">
        The channel&rsquo;s strategy — pillars, recurring ideas and notes the whole team works from.
      </p>

      <StrategyEditor
        workspaceId={workspaceId}
        initial={strategy}
        canEdit={canEdit}
        canCreatePipeline={access.canEdit}
        accent={workspace.brandAccent}
        pillarCounts={pillarCounts}
      />
    </>
  );
}
