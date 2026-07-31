import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { logError } from '@/lib/logger';

type RouteParams = { params: Promise<{ userId: string }> };

// GET /api/admin/users/[userId]/workspace-access — every workspace + this
// user's current membership (if any), for the admin per-user access page.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'api');
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.isAdmin) {
      return apiErrors.forbidden('Admin access required');
    }

    const { userId } = await params;

    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true },
    });

    if (!targetUser) {
      return apiErrors.notFound('User');
    }

    const [workspaces, memberships] = await Promise.all([
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

    const response = successResponse({ user: targetUser, workspaces, memberships });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error fetching user workspace access:', error);
    return apiErrors.internalError('Failed to fetch workspace access');
  }
}
