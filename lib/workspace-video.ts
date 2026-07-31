import { db } from '@/lib/db';

/**
 * The workspace's default project — an internal implementation detail behind
 * the flattened workspace→videos hierarchy. Shared by every path that creates
 * a video directly under a workspace (planned-idea creation, Drive multi-select
 * "New Video") so they don't drift into two different default projects.
 */
export async function findOrCreateDefaultProject(
  workspaceId: string,
  ownerId: string
): Promise<{ id: string }> {
  const existing = await db.project.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existing) return existing;

  return db.project.create({
    data: {
      name: 'Content',
      slug: `content-${workspaceId.slice(-8)}-${Date.now().toString(36)}`,
      description: null,
      workspaceId,
      ownerId,
      visibility: 'PRIVATE',
    },
    select: { id: true },
  });
}
