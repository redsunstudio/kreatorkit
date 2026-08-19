import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { createPresignedFileGetUrl } from '@/lib/r2';
import { mediaUrlToKey } from '@/lib/r2-cleanup';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string; commentId: string }>;
}

const KINDS = ['image', 'voice', 'file', 'annotation'] as const;
type Kind = (typeof KINDS)[number];

function sanitizeFileName(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._ ()-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.length > 0 ? sanitized : 'attachment';
}

// GET /api/agent/videos/[videoId]/comments/[commentId]/attachment?kind=image|voice|file|annotation
//
// The half of review feedback that is not text. A client marks up a frame, drops a
// screenshot, or records a voice note, and until now the agent rail could only see a
// boolean saying one existed -- the file itself sat behind the session-authed
// /api/upload/* routes, so answering "what did they circle?" meant opening a browser
// and reading it by eye. That detour cost two passes on one job.
//
// Media redirects to a short-lived presigned storage URL rather than streaming through
// the app. Annotations are strokes, not a file, so they come back as JSON.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId, commentId } = await params;

    const wanted = request.nextUrl.searchParams.get('kind');
    if (wanted && !KINDS.includes(wanted as Kind)) {
      return apiErrors.badRequest(`kind must be one of ${KINDS.join(', ')}`);
    }

    // Scoped to the videoId in the path so a comment id alone cannot reach another
    // client's item. videoParentId, NOT videoId: VideoVersion.videoId is the PROVIDER's
    // id for the file, and the item the cut hangs off is videoParentId. Both are Strings,
    // so the wrong one typechecks and quietly matches nothing.
    const comment = await db.comment.findFirst({
      where: { id: commentId, version: { videoParentId: videoId } },
      select: {
        id: true,
        imageUrl: true,
        voiceUrl: true,
        fileUrl: true,
        fileName: true,
        annotationData: true,
        timestamp: true,
      },
    });
    if (!comment) return apiErrors.notFound('Comment');

    const available: Kind[] = [
      comment.imageUrl ? 'image' : null,
      comment.voiceUrl ? 'voice' : null,
      comment.fileUrl ? 'file' : null,
      comment.annotationData ? 'annotation' : null,
    ].filter((k): k is Kind => k !== null);

    if (available.length === 0) {
      return apiErrors.notFound('Attachment');
    }
    // No kind asked for and exactly one exists: serve it. More than one is ambiguous,
    // and a silent pick would hand back a voice note when the caller wanted the drawing.
    const kind = (wanted as Kind | null) ?? (available.length === 1 ? available[0] : null);
    if (!kind) {
      return apiErrors.badRequest(
        `comment has several attachments (${available.join(', ')}) -- pass ?kind=`
      );
    }
    if (!available.includes(kind)) {
      return apiErrors.notFound(`No ${kind} attachment on this comment`);
    }

    if (kind === 'annotation') {
      let strokes: unknown = null;
      try {
        strokes = JSON.parse(comment.annotationData as string);
      } catch {
        return apiErrors.internalError('Annotation data is not readable');
      }
      return withCacheControl(
        successResponse({
          commentId: comment.id,
          kind,
          timestamp: comment.timestamp,
          strokes,
        }),
        'private, no-store'
      );
    }

    const sourceUrl =
      kind === 'image' ? comment.imageUrl : kind === 'voice' ? comment.voiceUrl : comment.fileUrl;
    const key = mediaUrlToKey(sourceUrl as string);
    if (!key) return apiErrors.badRequest(`Unreadable ${kind} attachment URL`);

    const fallback = key.slice(key.lastIndexOf('/') + 1);
    const downloadName = sanitizeFileName(
      kind === 'file' && comment.fileName ? comment.fileName : fallback
    );

    const presigned = await createPresignedFileGetUrl(key, downloadName);
    return NextResponse.redirect(presigned, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    logError('agent comment attachment failed:', error);
    return apiErrors.internalError('Failed to load attachment');
  }
}
