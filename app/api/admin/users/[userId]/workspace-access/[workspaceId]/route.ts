import { NextRequest } from 'next/server';
import { WorkspaceMemberRole } from '@prisma/client';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { logError } from '@/lib/logger';
import { removeWorkspaceMember } from '@/lib/workspace-members';

type RouteParams = { params: Promise<{ userId: string; workspaceId: string }> };

// PUT /api/admin/users/[userId]/workspace-access/[workspaceId] — upsert this
// user's membership + role on the workspace. Admin-only, bypasses the
// invite-email flow entirely since the admin already knows the account exists.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'manage-member');
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.isAdmin) {
      return apiErrors.forbidden('Admin access required');
    }

    const { userId, workspaceId } = await params;

    const body = await request.json();
    const { role } = body;
    const validRoles: WorkspaceMemberRole[] = ['ADMIN', 'COMMENTATOR'];
    if (!validRoles.includes(role)) {
      return apiErrors.badRequest('Invalid role. Must be ADMIN or COMMENTATOR.');
    }

    const [targetUser, workspace] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { id: true } }),
      db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, ownerId: true } }),
    ]);

    if (!targetUser) return apiErrors.notFound('User');
    if (!workspace) return apiErrors.notFound('Workspace');

    if (workspace.ownerId === userId) {
      return apiErrors.badRequest('Cannot add the workspace owner as a member');
    }

    const membership = await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      update: { role },
      create: { workspaceId, userId, role },
      select: { id: true, workspaceId: true, role: true },
    });

    const response = successResponse(membership);
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error updating user workspace access:', error);
    return apiErrors.internalError('Failed to update workspace access');
  }
}

// DELETE /api/admin/users/[userId]/workspace-access/[workspaceId] — remove
// this user's membership. Reuses the same reassignment transaction the
// workspace-scoped members route uses (owned projects fall back to the
// workspace owner, never orphaned).
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'manage-member');
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.isAdmin) {
      return apiErrors.forbidden('Admin access required');
    }

    const { userId, workspaceId } = await params;

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) return apiErrors.notFound('Workspace');

    await removeWorkspaceMember(workspaceId, userId);

    const response = successResponse({ message: 'Membership removed' });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error removing user workspace access:', error);
    return apiErrors.internalError('Failed to remove workspace access');
  }
}
