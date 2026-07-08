import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';
import { workspaceYouTubeAccountId } from '@/lib/publish-video';
import { isZernioConfigured } from '@/lib/zernio';
import { VideoItemClient } from '@/components/video-item/item-client';

interface ItemPageProps {
  params: Promise<{ workspaceId: string; videoId: string }>;
}

export default async function VideoItemPage({ params }: ItemPageProps) {
  const session = await auth();
  const { workspaceId, videoId } = await params;
  if (!session?.user?.id) redirect('/login');

  const video = await db.video.findUnique({
    where: { id: videoId },
    include: {
      project: { select: { id: true, workspaceId: true } },
      versions: {
        orderBy: { versionNumber: 'desc' },
        select: { id: true, versionNumber: true, versionLabel: true, isActive: true },
      },
    },
  });
  if (!video || video.project.workspaceId !== workspaceId) notFound();

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
  });
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
          versions: video.versions.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            versionLabel: v.versionLabel,
            isActive: v.isActive,
          })),
        }}
        canEdit={isAdmin || access.canEdit}
        publishReady={
          isZernioConfigured() && Boolean(workspaceYouTubeAccountId(workspace.publishing))
        }
      />
    </div>
  );
}
