import { notFound, redirect } from 'next/navigation';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { BrandAssetsClient } from '@/components/workspace/brand-assets-client';

interface AssetsPanelProps {
  workspaceId: string;
}

/**
 * The assets panel. Rendered by the route page on a hard load / deep link,
 * and by loadWorkspacePanel (../panel-actions) when the tab shell switches
 * to it client-side. Does its own auth + access check either way.
 */
export async function AssetsPanel({ workspaceId }: AssetsPanelProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const [{ workspace: accessWorkspace, access }, workspace] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({ where: { id: workspaceId } }),
  ]);
  if (!workspace || !accessWorkspace || !access) notFound();
  if (!access.hasAccess || !hasModule(workspace, 'assets')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  return <BrandAssetsClient workspaceId={workspaceId} />;
}
