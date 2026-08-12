import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { InvitationRole, InvitationScope, WorkspaceMemberRole } from '@prisma/client';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import {
  buildInvitationUrl,
  createOrRefreshInvitation,
  sendInvitationEmail,
} from '@/lib/invitations';
import { isValidEmailAddress, normalizeEmail } from '@/lib/email-validation';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ workspaceId: string }>;
}

/**
 * Client access management for automation.
 *
 * Onboarding a client meant opening the UI and inviting them workspace by
 * workspace, and nothing outside the app could see who actually had access —
 * the agent roster exposed member COUNTS but never names, so "why can't the
 * client see their board" could not be answered without a database session.
 *
 * GET answers that. POST grants access by email, matching what the Members
 * dialog does: an existing user becomes a member immediately, a stranger gets
 * an invitation email, and re-running either one is a no-op rather than a
 * duplicate.
 *
 * The workspace id may be given as an id or a slug, because callers resolving
 * a client by name have the slug, not the cuid.
 */

async function resolveWorkspace(idOrSlug: string) {
  return db.workspace.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, name: true, slug: true, ownerId: true },
  });
}

// GET /api/agent/workspaces/[workspaceId]/members — who can see this client
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId } = await params;

    const workspace = await resolveWorkspace(workspaceId);
    if (!workspace) return apiErrors.notFound('Workspace');

    const [owner, members, invitations] = await Promise.all([
      db.user.findUnique({
        where: { id: workspace.ownerId },
        select: { id: true, email: true, name: true },
      }),
      db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.invitation.findMany({
        where: { workspaceId: workspace.id, status: 'PENDING' },
        select: { id: true, email: true, role: true, expiresAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return withCacheControl(
      successResponse({
        workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
        // The owner has full access without a membership row, so a member list
        // that omits them reads as "nobody can see this".
        owner,
        members: members.map((m) => ({
          id: m.id,
          role: m.role,
          createdAt: m.createdAt,
          userId: m.user.id,
          email: m.user.email,
          name: m.user.name,
        })),
        pendingInvitations: invitations,
      }),
      'private, no-store'
    );
  } catch (error) {
    logError('agent workspace members list failed:', error);
    return apiErrors.internalError('Failed to list members');
  }
}

// POST /api/agent/workspaces/[workspaceId]/members — grant access by email
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { workspaceId } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.email !== 'string') {
      return apiErrors.badRequest('email is required');
    }

    const email = normalizeEmail(body.email);
    if (!isValidEmailAddress(email)) {
      return apiErrors.badRequest('Invalid email address');
    }

    const roleInput = typeof body.role === 'string' ? body.role.toUpperCase() : 'COMMENTATOR';
    if (roleInput !== 'ADMIN' && roleInput !== 'COMMENTATOR') {
      return apiErrors.badRequest('role must be ADMIN or COMMENTATOR');
    }

    const workspace = await resolveWorkspace(workspaceId);
    if (!workspace) return apiErrors.notFound('Workspace');

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      if (user.id === workspace.ownerId) {
        return successResponse({
          status: 'owner',
          email,
          workspace: workspace.slug,
          message: 'Already the workspace owner — full access, no membership needed',
        });
      }

      const existing = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
        select: { id: true, role: true },
      });

      const member = existing
        ? await db.workspaceMember.update({
            where: { id: existing.id },
            data: { role: roleInput as WorkspaceMemberRole },
            select: { id: true, role: true },
          })
        : await db.workspaceMember.create({
            data: {
              workspaceId: workspace.id,
              userId: user.id,
              role: roleInput as WorkspaceMemberRole,
            },
            select: { id: true, role: true },
          });

      return successResponse({
        status: existing ? 'already-member' : 'added',
        email,
        name: user.name,
        role: member.role,
        workspace: workspace.slug,
      });
    }

    // No account yet: invite, exactly as the Members dialog would. The owner is
    // the inviter so the email carries a name the client recognises.
    const owner = await db.user.findUnique({
      where: { id: workspace.ownerId },
      select: { id: true, name: true, email: true },
    });
    if (!owner) return apiErrors.internalError('Workspace has no owner to invite from');

    const invitation = await createOrRefreshInvitation({
      email,
      scope: InvitationScope.WORKSPACE,
      role: roleInput as InvitationRole,
      invitedById: owner.id,
      workspaceId: workspace.id,
    });

    const sent = await sendInvitationEmail({
      to: email,
      inviterName: owner.name || owner.email || 'KreatorKit',
      role: roleInput as InvitationRole,
      scope: InvitationScope.WORKSPACE,
      targetName: workspace.name,
      invitationUrl: buildInvitationUrl(invitation.token),
      workspaceId: workspace.id,
    });

    return successResponse({
      status: 'invited',
      email,
      role: roleInput,
      workspace: workspace.slug,
      emailSent: sent,
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    logError('agent workspace member grant failed:', error);
    return apiErrors.internalError('Failed to grant access');
  }
}
