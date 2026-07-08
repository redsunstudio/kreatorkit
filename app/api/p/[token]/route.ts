import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { getPostReviewByToken } from '@/lib/post-review';
import { sendEmail, isEmailDeliveryConfigured } from '@/lib/mailer';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ token: string }>;
}

async function pingOwner(workspaceId: string, subject: string, line: string, title: string) {
  if (!isEmailDeliveryConfigured()) return;
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, owner: { select: { email: true } } },
  });
  if (!workspace?.owner.email) return;
  await sendEmail({
    to: workspace.owner.email,
    subject,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px">KreatorKit</h2>
        <p style="font-size:15px">${line}</p>
        <p style="color:#555">Post: <strong>${title.replace(/</g, '&lt;')}</strong><br/>Workspace: ${workspace.name.replace(/</g, '&lt;')}</p>
      </div>`,
  }).catch(() => undefined);
}

// POST /api/p/[token] { action: 'approve' } | { action: 'feedback', body, name? }
// The share token IS the auth — this is the client's one-tap review.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;
    const { token } = await params;
    const ctx = await getPostReviewByToken(token);
    if (!ctx || ctx.video.videoType !== 'POST') return apiErrors.notFound('Review');
    const { video, workspace } = ctx;

    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action === 'approve') {
      if (
        video.status !== 'APPROVED' &&
        video.status !== 'PUBLISHED' &&
        video.status !== 'ARCHIVED'
      ) {
        await db.video.update({ where: { id: video.id }, data: { status: 'APPROVED' } });
        await db.videoNote.create({
          data: { videoId: video.id, body: '✅ Approved via the review link' },
        });
        await pingOwner(
          workspace.id,
          `[KreatorKit] ✅ Post approved: ${video.title}`,
          'The client just approved this post via the review link — it is cleared to push.',
          video.title
        );
      }
      return withCacheControl(successResponse({ status: 'APPROVED' }), 'private, no-store');
    }

    if (action === 'feedback') {
      const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 4000) : '';
      if (!text) return apiErrors.badRequest('feedback text is required');
      const name =
        typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;
      await db.videoNote.create({
        data: {
          videoId: video.id,
          body: `💬 Review feedback${name ? ` from ${name}` : ''}: ${text}`,
        },
      });
      await pingOwner(
        workspace.id,
        `[KreatorKit] 💬 Feedback on: ${video.title}`,
        `New feedback via the review link${name ? ` from ${name}` : ''}: “${text.replace(/</g, '&lt;').slice(0, 400)}”`,
        video.title
      );
      return withCacheControl(successResponse({ ok: true }), 'private, no-store');
    }

    return apiErrors.badRequest('unknown action');
  } catch (error) {
    logError('post review action failed:', error);
    return apiErrors.internalError('Could not record that — try again');
  }
}
