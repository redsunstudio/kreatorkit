import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { isAgentRequest } from '@/lib/agent-auth';
import { logError } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ videoId: string }>;
}

const commentSelect = {
  id: true,
  content: true,
  timestamp: true,
  timestampEnd: true,
  isResolved: true,
  resolvedAt: true,
  voiceUrl: true,
  imageUrl: true,
  fileUrl: true,
  fileName: true,
  annotationData: true,
  guestName: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true } },
  tag: { select: { name: true, color: true } },
} as const;

function shapeComment(c: {
  id: string;
  content: string | null;
  timestamp: number;
  timestampEnd: number | null;
  isResolved: boolean;
  resolvedAt: Date | null;
  voiceUrl: string | null;
  imageUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  annotationData: string | null;
  guestName: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string | null } | null;
  tag: { name: string; color: string } | null;
}) {
  return {
    id: c.id,
    content: c.content,
    timestamp: c.timestamp,
    timestampEnd: c.timestampEnd,
    isResolved: c.isResolved,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    hasVoice: !!c.voiceUrl,
    hasImage: !!c.imageUrl,
    hasFile: !!c.fileUrl,
    fileName: c.fileName,
    hasAnnotation: !!c.annotationData,
    authorName: c.author?.name ?? c.guestName ?? 'Guest',
    isTeam: !!c.author, // registered users are team; guests came via a share link
    tag: c.tag,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// GET /api/agent/videos/[videoId]/comments — full review threads for automation.
// Comments hang off versions; returns every version's threads plus a rollup so
// the Agency OS can tell which items have feedback waiting.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        status: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            isActive: true,
            comments: {
              where: { parentId: null },
              orderBy: { timestamp: 'asc' },
              select: {
                ...commentSelect,
                replies: { orderBy: { createdAt: 'asc' }, select: commentSelect },
              },
            },
          },
        },
      },
    });
    if (!video) return apiErrors.notFound('Video');

    const versions = video.versions.map((v) => ({
      versionId: v.id,
      versionNumber: v.versionNumber,
      isActive: v.isActive,
      comments: v.comments.map((c) => ({
        ...shapeComment(c),
        replies: c.replies.map(shapeComment),
      })),
    }));

    const all = versions.flatMap((v) => v.comments);
    const open = all.filter((c) => !c.isResolved);
    // A thread is awaiting the team when it's unresolved and the last word
    // belongs to the client/guest (no team reply after it).
    const awaitingReply = open.filter((c) => {
      const last = c.replies[c.replies.length - 1];
      return last ? !last.isTeam : !c.isTeam;
    });

    return withCacheControl(
      successResponse({
        id: video.id,
        title: video.title,
        status: video.status,
        totalComments: all.length,
        openComments: open.length,
        awaitingReply: awaitingReply.length,
        versions,
      }),
      'private, no-store'
    );
  } catch (error) {
    logError('agent video comments failed:', error);
    return apiErrors.internalError('Failed to load comments');
  }
}

// POST /api/agent/videos/[videoId]/comments — write a timestamped note onto a cut.
//
// The agent rail could read review threads but not write to them, so an automated pass had
// no way to leave a marker on the timeline: "the screenshare runs from here to here", "this
// is the seam", "this needs a pickup". Those are exactly the notes a human would otherwise
// have to place by hand while scrubbing.
//
// Defaults to the ACTIVE version, because that is the cut the client is looking at; pass
// versionId to pin a note to an older one. `timestampEnd` makes it a range marker rather
// than a point, which is what a screenshare or a chapter actually is.
//
// Agent comments are attributed to a guest name rather than borrowed from a real user, so a
// machine-written note is never mistaken for the client's own feedback in the thread.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const body = await request.json().catch(() => null);

    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    const timestamp = typeof body?.timestamp === 'number' ? body.timestamp : NaN;
    const timestampEnd = typeof body?.timestampEnd === 'number' ? body.timestampEnd : null;
    const authorName =
      typeof body?.authorName === 'string' && body.authorName.trim()
        ? body.authorName.trim().slice(0, 80)
        : 'Agency OS';
    const parentId = typeof body?.parentId === 'string' ? body.parentId : null;
    const wantVersionId = typeof body?.versionId === 'string' ? body.versionId : null;

    if (!content) return apiErrors.badRequest('content is required');
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      return apiErrors.badRequest('timestamp (seconds, >= 0) is required');
    }
    if (timestampEnd !== null && !(timestampEnd > timestamp)) {
      return apiErrors.badRequest('timestampEnd must be greater than timestamp');
    }

    const video = await db.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: { id: true, isActive: true, versionNumber: true },
        },
      },
    });
    if (!video) return apiErrors.notFound('Video');

    const version = wantVersionId
      ? video.versions.find((v) => v.id === wantVersionId)
      : (video.versions.find((v) => v.isActive) ?? video.versions[0]);
    if (!version) {
      return apiErrors.badRequest(
        wantVersionId ? 'versionId not found on this video' : 'video has no cut to comment on'
      );
    }

    // A reply must hang off a comment on the SAME version, or the thread would render
    // split across two cuts.
    if (parentId) {
      const parent = await db.comment.findUnique({
        where: { id: parentId },
        select: { id: true, versionId: true },
      });
      if (!parent || parent.versionId !== version.id) {
        return apiErrors.badRequest('parentId must be a comment on the same version');
      }
    }

    const comment = await db.comment.create({
      data: {
        content,
        timestamp,
        timestampEnd,
        parentId,
        guestName: authorName,
        versionId: version.id,
      },
      select: commentSelect,
    });

    return successResponse({
      ...shapeComment(comment),
      versionId: version.id,
      versionNumber: version.versionNumber,
    });
  } catch (error) {
    logError('agent comment create failed:', error);
    return apiErrors.internalError('Failed to create comment');
  }
}
