import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { ModuleNav } from '@/components/workspace/module-nav';
import { BrandAssetsClient } from '@/components/workspace/brand-assets-client';

interface AssetsPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceAssetsPage({ params }: AssetsPageProps) {
  const session = await auth();
  const { workspaceId } = await params;
  if (!session?.user?.id) redirect('/login');

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) notFound();
  const access = await checkWorkspaceAccess(
    { id: workspace.id, ownerId: workspace.ownerId },
    session.user.id
  );
  if (!access.hasAccess || !hasModule(workspace, 'assets')) {
    redirect(`/workspaces/${workspaceId}`);
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

      <ModuleNav workspace={workspace} active="assets" />

      <BrandAssetsClient workspaceId={workspaceId} />
    </div>
  );
}
