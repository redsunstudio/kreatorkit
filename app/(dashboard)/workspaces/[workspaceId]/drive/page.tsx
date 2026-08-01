import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth, getWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasModule } from '@/lib/workspace-features';
import { ModuleNav } from '@/components/workspace/module-nav';
import {
  driveFileDTO,
  driveFolderDTO,
  driveLinkDTO,
  resolveLinkBaseUrl,
} from '@/lib/workspace-drive';
import { DriveClient } from './drive-client';

interface DrivePageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function DrivePage({ params }: DrivePageProps) {
  const session = await auth();
  const { workspaceId } = await params;
  if (!session?.user?.id) redirect('/login');

  const [{ workspace: accessWorkspace, access }, workspace, items, files, folders] =
    await Promise.all([
      getWorkspaceAccess(workspaceId, session.user.id),
      db.workspace.findUnique({ where: { id: workspaceId } }),
      // Assign targets: anything still in production. Published/archived items
      // are finished — dropping raw footage on them is almost always a mis-click.
      db.video.findMany({
        where: {
          project: { workspaceId },
          status: { notIn: ['PUBLISHED', 'ARCHIVED', 'REJECTED'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        select: { id: true, title: true, status: true },
      }),
      // Root-level drive contents — first paint, no client-side fetch needed.
      db.workspaceUpload.findMany({
        where: { workspaceId, folderId: null },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          displayName: true,
          contentType: true,
          sizeBytes: true,
          uploaderName: true,
          createdAt: true,
          link: { select: { label: true } },
          folder: { select: { id: true, name: true } },
        },
      }),
      db.workspaceUploadFolder.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, createdAt: true, _count: { select: { uploads: true } } },
      }),
    ]);
  if (!workspace || !accessWorkspace || !access) notFound();
  if (!access.hasAccess || !hasModule(workspace, 'drive')) {
    redirect(`/workspaces/${workspaceId}`);
  }

  const isAdmin = access.isOwner || access.isAdmin;

  // Grab links are admin-only (an unauthenticated write door into the
  // bucket) — only fetch them for the users who'll actually see the section.
  const links = isAdmin
    ? await db.workspaceUploadLink.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { _count: { select: { uploads: true } } },
      })
    : [];
  const hdrs = await headers();
  const host = hdrs.get('host');
  const fallbackOrigin = host ? `${hdrs.get('x-forwarded-proto') ?? 'https'}://${host}` : '';
  const linkBaseUrl = resolveLinkBaseUrl(fallbackOrigin);

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

      <DriveClient
        workspaceId={workspaceId}
        isAdmin={isAdmin}
        items={items}
        initialFiles={files.map(driveFileDTO)}
        initialFolders={folders.map(driveFolderDTO)}
        initialLinks={links.map((l) => driveLinkDTO(l, linkBaseUrl))}
      />
    </div>
  );
}
