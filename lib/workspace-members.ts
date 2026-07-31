import { db } from '@/lib/db';

/**
 * Removes a user's WorkspaceMember row, reassigning any Projects they own in
 * that workspace back to the workspace owner and clearing their ProjectMember
 * rows first. Shared by the workspace-scoped members route and the admin
 * per-user workspace-access route so both paths stay in sync — copying this
 * transaction instead of calling it risks silently skipping the project
 * reassignment step and orphaning ownership.
 */
export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  await db.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: {
        userId,
        project: { workspaceId },
      },
    });

    await tx.project.updateMany({
      where: {
        workspaceId,
        ownerId: userId,
      },
      data: {
        ownerId: workspace.ownerId,
      },
    });

    await tx.workspaceMember.deleteMany({ where: { workspaceId, userId } });
  });
}
