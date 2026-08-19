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
    // What the agent can actually go and FETCH for this comment, by kind. The
    // booleans above say a thing exists; this says which ones the attachment
    // route will serve, so an automated pass can pull a client's screenshot or
    // drawing without a browser login instead of guessing from a flag.
    attachments: [
      c.imageUrl ? 'image' : null,
      c.voiceUrl ? 'voice' : null,
      c.fileUrl ? 'file' : null,
      c.annotationData ? 'annotation' : null,
    ].filter((k): k is string => k !== null),
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
    // Coloured tag, by NAME. The session route takes a tagId, but an agent has no way to
    // discover one, and a per-project tag is cheap to find-or-create. `tagColor` only
    // applies when the tag does not exist yet, so a human renaming or recolouring a tag in
    // the UI is never overwritten by a later agent post.
    const tagName =
      typeof body?.tag === 'string' && body.tag.trim() ? body.tag.trim().slice(0, 40) : null;
    const tagColor =
      typeof body?.tagColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.tagColor.trim())
        ? body.tagColor.trim()
        : '#F16333';

    if (!content) return apiErrors.badRequest('content is required');
    // A REPLY inherits its parent's timestamp and version (resolved below): the thread
    // is already pinned to a moment, and asking an automated reply to restate it is how
    // you end up with a reply that renders at the wrong point on the timeline.
    if (!parentId && (!Number.isFinite(timestamp) || timestamp < 0)) {
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

    // A reply takes its version from the PARENT, not from the active cut. Feedback is
    // usually answered after the fix has already shipped as a new version, so pinning
    // the reply to the active cut would strand it on a version the client never asked
    // the question on -- and the thread would render split across two cuts.
    let parent: { id: string; versionId: string; timestamp: number } | null = null;
    if (parentId) {
      parent = await db.comment.findUnique({
        where: { id: parentId },
        select: { id: true, versionId: true, timestamp: true },
      });
      if (!parent) return apiErrors.notFound('Parent comment');
      if (wantVersionId && wantVersionId !== parent.versionId) {
        return apiErrors.badRequest('versionId does not match the parent comment');
      }
    }

    const version = parent
      ? video.versions.find((v) => v.id === parent.versionId)
      : wantVersionId
        ? video.versions.find((v) => v.id === wantVersionId)
        : (video.versions.find((v) => v.isActive) ?? video.versions[0]);
    if (!version) {
      return apiErrors.badRequest(
        parent
          ? 'parentId belongs to a different video'
          : wantVersionId
            ? 'versionId not found on this video'
            : 'video has no cut to comment on'
      );
    }

    const effectiveTimestamp = parent && !Number.isFinite(timestamp) ? parent.timestamp : timestamp;

    // Tags are per PROJECT, so resolve against the project this video belongs to.
    let tagId: string | null = null;
    if (tagName) {
      const owner = await db.video.findUnique({
        where: { id: videoId },
        select: { projectId: true },
      });
      if (owner?.projectId) {
        const existing = await db.commentTag.findUnique({
          where: { projectId_name: { projectId: owner.projectId, name: tagName } },
          select: { id: true },
        });
        tagId =
          existing?.id ??
          (
            await db.commentTag.create({
              data: { name: tagName, color: tagColor, projectId: owner.projectId },
              select: { id: true },
            })
          ).id;
      }
    }

    const comment = await db.comment.create({
      data: {
        content,
        timestamp: effectiveTimestamp,
        timestampEnd,
        parentId,
        guestName: authorName,
        versionId: version.id,
        tagId,
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

// PATCH /api/agent/videos/[videoId]/comments — close (or reopen) a review thread.
//
// Replying to feedback and CLOSING it are two different acts, and only one of them was
// possible from the rail: a thread the agent had already actioned stayed open forever,
// so the open count stopped meaning "still outstanding" and the client's board filled
// with feedback that had in fact been dealt with two versions ago.
//
// Only `isResolved` moves. Content, tag and annotation stay the author's -- an agent
// that could edit a client's own words could quietly rewrite the record of what they
// asked for.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isAgentRequest(request)) return apiErrors.unauthorized();
    const { videoId } = await params;
    const body = await request.json().catch(() => null);

    const commentId = typeof body?.commentId === 'string' ? body.commentId : '';
    const isResolved = typeof body?.isResolved === 'boolean' ? body.isResolved : null;
    if (!commentId) return apiErrors.badRequest('commentId is required');
    if (isResolved === null) return apiErrors.badRequest('isResolved (boolean) is required');

    // Scoped to the videoId in the path: an agent key holding one item's id must not be
    // able to reach a comment on somebody else's item by guessing a comment id.
    const comment = await db.comment.findFirst({
      where: { id: commentId, version: { videoId } },
      select: { id: true },
    });
    if (!comment) return apiErrors.notFound('Comment');

    const updated = await db.comment.update({
      where: { id: commentId },
      data: { isResolved, resolvedAt: isResolved ? new Date() : null },
      select: commentSelect,
    });

    return withCacheControl(successResponse(shapeComment(updated)), 'private, no-store');
  } catch (error) {
    logError('agent comment resolve failed:', error);
    return apiErrors.internalError('Failed to update comment');
  }
}
