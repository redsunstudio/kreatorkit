import { notFound, redirect } from 'next/navigation';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { BrandAssetsClient } from '@/components/workspace/brand-assets-client';

interface AssetsPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceAssetsPage({ params }: AssetsPageProps) {
  const session = await auth();
  const { workspaceId } = await params;
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
