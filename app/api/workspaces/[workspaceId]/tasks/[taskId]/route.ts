import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface Ctx {
  params: Promise<{ workspaceId: string; taskId: string }>;
}

async function resolveAdminAccess(workspaceId: string, userId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return null;
  if (workspace.ownerId === userId) return workspace;
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId },
  });
  if (member?.role === 'ADMIN') return workspace;
  return null;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { workspaceId, taskId } = await params;
  const workspace = await resolveAdminAccess(workspaceId, session.user.id);
  if (!workspace) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const task = await db.workspaceTask.findUnique({ where: { id: taskId } });
  if (!task || task.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const update: { text?: string; done?: boolean; sortOrder?: number } = {};

  if (typeof body.text === 'string') {
    const text = body.text.trim();
    if (!text || text.length > 500) {
      return NextResponse.json({ error: 'text must be 1–500 chars' }, { status: 400 });
    }
    update.text = text;
  }
  if (typeof body.done === 'boolean') update.done = body.done;
  if (typeof body.sortOrder === 'number') update.sortOrder = body.sortOrder;

  const updated = await db.workspaceTask.update({ where: { id: taskId }, data: update });
  return NextResponse.json({ data: { task: updated } });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { workspaceId, taskId } = await params;
  const workspace = await resolveAdminAccess(workspaceId, session.user.id);
  if (!workspace) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const task = await db.workspaceTask.findUnique({ where: { id: taskId } });
  if (!task || task.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.workspaceTask.delete({ where: { id: taskId } });
  return new NextResponse(null, { status: 204 });
}
