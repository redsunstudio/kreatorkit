import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { WorkspaceMemberRole } from '@prisma/client';

export interface DriveAccess {
  workspace: {
    id: string;
    name: string;
    ownerId: string;
    brandAccent: string | null;
    features: unknown;
  };
  userId: string;
  isAdmin: boolean;
}

/**
 * Drive access: any workspace MEMBER can see and sort the drive (that is the
 * job), but only an ADMIN/OWNER can mint or revoke a grab link — a link is an
 * unauthenticated write door into the bucket.
 */
export async function resolveDriveAccess(workspaceId: string): Promise<DriveAccess | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      brandAccent: true,
      features: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!workspace) return null;

  const isOwner = workspace.ownerId === userId;
  const membership = workspace.members[0];
  if (!isOwner && !membership) return null;

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      brandAccent: workspace.brandAccent,
      features: workspace.features,
    },
    userId,
    isAdmin: isOwner || membership?.role === WorkspaceMemberRole.ADMIN,
  };
}
