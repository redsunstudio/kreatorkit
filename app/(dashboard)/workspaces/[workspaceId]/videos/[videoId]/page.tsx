import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { isWorkspaceLinkedInReady, isWorkspacePublishReady } from '@/lib/publish-video';
import { hasModule } from '@/lib/workspace-features';
import { VideoItemClient } from '@/components/video-item/item-client';

interface ItemPageProps {
  params: Promise<{ workspaceId: string; videoId: string }>;
}

export default async function VideoItemPage({ params }: ItemPageProps) {
  const session = await auth();
  const { workspaceId, videoId } = await params;
  if (!session?.user?.id) redirect('/login');

  // Everything this page renders, in one parallel batch. These reads are
  // independent, so awaiting them one after another only added round trips —
  // and assets/notes used to be fetched by the client after hydration, which
  // meant the item painted empty and filled in a beat later.
  const [video, workspace, assets, notes] = await Promise.all([
    db.video.findUnique({
      where: { id: videoId },
      include: {
        project: { select: { id: true, workspaceId: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            versionLabel: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: { where: { userId: session.user.id }, select: { role: true } } },
    }),
    db.videoAsset.findMany({
      where: { videoId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        displayName: true,
        kind: true,
        sizeBytes: true,
        uploadedByGuestName: true,
        createdAt: true,
        uploadedByUser: { select: { name: true } },
      },
    }),
    db.videoNote.findMany({
      where: { videoId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { name: true } },
      },
    }),
  ]);

  if (!video || video.project.workspaceId !== workspaceId) notFound();
  if (!workspace) notFound();

  const access = await checkWorkspaceAccess(
    { id: workspace.id, ownerId: workspace.ownerId },
    session.user.id
  );
  if (!access.hasAccess) redirect('/dashboard');
  const isAdmin = session.user.id === workspace.ownerId || workspace.members[0]?.role === 'ADMIN';

  return (
    <div
      className="px-6 lg:px-8 py-8 w-full max-w-5xl mx-auto"
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

      <VideoItemClient
        workspaceId={workspaceId}
        video={{
          id: video.id,
          projectId: video.project.id,
          title: video.title,
          status: video.status,
          videoType: video.videoType,
          brief: video.brief,
          description: video.description,
          thumbnailUrl: video.thumbnailUrl,
          postOptions: (video.postOptions as { repostUrl?: string } | null) ?? null,
          storageClearedAt: video.storageClearedAt?.toISOString() ?? null,
          packagingConfirmedAt: video.packagingConfirmedAt?.toISOString() ?? null,
          packagingConfirmedName: video.packagingConfirmedName,
          membersOnly: video.membersOnly,
          versions: video.versions.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            versionLabel: v.versionLabel,
            isActive: v.isActive,
            createdAt: v.createdAt.toISOString(),
          })),
        }}
        initialAssets={assets.map((a) => ({
          id: a.id,
          displayName: a.displayName,
          kind: a.kind,
          // sizeBytes is a BigInt column — it cannot cross the server/client
          // boundary as-is, and the client only ever formats it.
          sizeBytes: a.sizeBytes.toString(),
          uploadedByUser: a.uploadedByUser,
          uploadedByGuestName: a.uploadedByGuestName,
          createdAt: a.createdAt.toISOString(),
        }))}
        initialNotes={notes.map((n) => ({
          id: n.id,
          body: n.body,
          createdAt: n.createdAt.toISOString(),
          author: n.author,
        }))}
        canEdit={isAdmin || access.canEdit}
        publishReady={isWorkspacePublishReady(workspace.publishing)}
        linkedInReady={isWorkspaceLinkedInReady(workspace.publishing)}
        allowPosts={hasModule(workspace, 'posts')}
      />
    </div>
  );
}
