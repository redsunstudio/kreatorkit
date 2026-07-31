import { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { WorkspaceAccessClient } from '@/app/admin/users/[userId]/workspace-access-client';

export const metadata: Metadata = {
  title: 'Manage Workspace Access | Admin',
};

export default async function AdminUserWorkspaceAccessPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  const { userId } = await params;

  const [targetUser, workspaces, memberships] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true },
    }),
    db.workspace.findMany({
      select: {
        id: true,
        name: true,
        ownerId: true,
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { name: 'asc' },
    }),
    db.workspaceMember.findMany({
      where: { userId },
      select: { id: true, workspaceId: true, role: true },
    }),
  ]);

  if (!targetUser) {
    notFound();
  }

  return (
    <div className="flex-1 space-y-4">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Users
        </Link>
      </div>

      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          {targetUser.name || targetUser.email || 'Unnamed user'}
        </h2>
        <p className="text-muted-foreground mt-1">{targetUser.email}</p>
      </div>

      <WorkspaceAccessClient
        userId={targetUser.id}
        workspaces={workspaces}
        initialMemberships={memberships}
      />
    </div>
  );
}
