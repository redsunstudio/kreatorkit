import { NextRequest, NextResponse } from 'next/server';
import { auth, checkWorkspaceAccess } from '@/lib/auth';
import { db } from '@/lib/db';

interface Ctx {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { workspaceId } = await params;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await checkWorkspaceAccess(
    { id: workspace.id, ownerId: workspace.ownerId },
    session.user.id
  );
  if (!access.hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tasks = await db.workspaceTask.findMany({
    where: { workspaceId },
    orderBy: [{ done: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  return NextResponse.json({ data: { tasks } });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { workspaceId } = await params;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = session.user.id === workspace.ownerId;
  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
  });
  const isAdmin = isOwner || membership?.role === 'ADMIN';
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 500) {
    return NextResponse.json({ error: 'text must be 1–500 chars' }, { status: 400 });
  }

  const maxOrder = await db.workspaceTask.aggregate({
    where: { workspaceId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const task = await db.workspaceTask.create({
    data: { workspaceId, text, sortOrder },
  });

  return NextResponse.json({ data: { task } }, { status: 201 });
}
