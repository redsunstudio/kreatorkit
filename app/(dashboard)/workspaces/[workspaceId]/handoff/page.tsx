import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { ModuleNav } from '@/components/workspace/module-nav';

interface HandoffPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function HandoffPage({ params }: HandoffPageProps) {
  const session = await auth();
  const { workspaceId } = await params;

  if (!session?.user?.id) {
    redirect('/login');
  }

  const [{ workspace: accessWorkspace, access }, workspace] = await Promise.all([
    getWorkspaceAccess(workspaceId, session.user.id),
    db.workspace.findUnique({ where: { id: workspaceId } }),
  ]);
  if (!workspace || !accessWorkspace || !access) notFound();
  if (!access.hasAccess || !hasModule(workspace, 'handoff')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  return (
    <div className="px-6 lg:px-8 py-8 w-full">
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

      <ModuleNav workspace={workspace} active="handoff" />

      <Card>
        <CardContent className="py-14 flex flex-col items-center text-center gap-4">
          <Inbox className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Footage lives on each video</h2>
          <div className="text-sm text-muted-foreground max-w-md space-y-2 text-left">
            <p>
              1. Open the pipeline and pick the video the footage belongs to — or create it with
              &ldquo;New video idea&rdquo;.
            </p>
            <p>
              2. Drag your files into the Footage section on that item. Big files upload in
              parallel; keep the tab open until they finish.
            </p>
            <p>
              3. Done — the team is notified, and you&rsquo;ll get an email when a cut is ready to
              review.
            </p>
          </div>
          <Link
            href={`/workspaces/${workspaceId}`}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Open the pipeline
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
